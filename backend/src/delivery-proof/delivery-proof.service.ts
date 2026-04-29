import { BadRequestException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Keypair } from '@stellar/stellar-sdk';

import { PaginatedResponse, PaginationUtil } from '../common/pagination';
import { CreateDeliveryProofDto } from './dto/create-delivery-proof.dto';
import { DeliveryProofQueryDto } from './dto/delivery-proof-query.dto';
import { DeliveryProofEntity } from './entities/delivery-proof.entity';
import { SorobanService } from '../soroban/soroban.service';
import { CustodyService } from '../custody/custody.service';
import { UploadValidationService } from './upload-validation.service';
import { FileMetadataService } from '../file-metadata/file-metadata.service';
import { FileOwnerType } from '../file-metadata/entities/file-metadata.entity';

// Blood products must be stored between 2°C and 6°C (backend compliance threshold)
const TEMP_MIN_CELSIUS = 2;
const TEMP_MAX_CELSIUS = 6;

interface TrustedSignerKey {
  kid: string;
  publicKey: string;
}

export interface DeliveryStatistics {
  totalDeliveries: number;
  successfulDeliveries: number;
  successRate: number;
  temperatureCompliantDeliveries: number;
  temperatureComplianceRate: number;
  averageTemperatureCelsius: number | null;
}

@Injectable()
export class DeliveryProofService {
  private readonly logger = new Logger(DeliveryProofService.name);

  constructor(
    @InjectRepository(DeliveryProofEntity)
    private readonly proofRepo: Repository<DeliveryProofEntity>,
    private readonly configService: ConfigService,
    private readonly sorobanService: SorobanService,
    private readonly custodyService: CustodyService,
    private readonly uploadValidation: UploadValidationService,
    private readonly fileMetadata: FileMetadataService,
  ) {}

  async uploadPhoto(orderId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');

    // Validate against photo policy (MIME, extension, size, content sniffing).
    this.uploadValidation.validate(file, 'photo');

    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const auditMeta = this.uploadValidation.buildAuditMetadata(file, 'photo', hash);

    const storagePath = this.configService.get<string>('STORAGE_PATH', './uploads');
    if (!fs.existsSync(storagePath)) fs.mkdirSync(storagePath, { recursive: true });

    const fileExt = path.extname(file.originalname) || '.png';
    const fileName = `dp-${orderId}-${Date.now()}${fileExt}`;
    try {
      fs.writeFileSync(path.join(storagePath, fileName), file.buffer);
    } catch (err) {
      this.logger.error(`Failed to write file to storage: ${err.message}`);
      throw new BadRequestException('Internal Storage Error');
    }

    const storageUrl = `${storagePath}/${fileName}`;

    await this.fileMetadata.replace({
      ownerType: FileOwnerType.DELIVERY_PROOF,
      ownerId: orderId,
      storagePath: path.join(storagePath, fileName),
      originalFilename: file.originalname,
      contentType: file.mimetype,
      sizeBytes: file.size,
      sha256Hash: hash,
    });

    let proof = await this.proofRepo.findOne({ where: { orderId } });
    if (!proof) {
      proof = this.proofRepo.create({
        orderId,
        riderId: 'SYSTEM',
        pickupTimestamp: new Date(),
        deliveredAt: new Date(),
        recipientName: 'Automatic Verification',
        temperatureReadings: [4.0],
        photoHashes: [],
      });
    }

    proof.photoUrl = storageUrl;
    if (!proof.photoHashes) proof.photoHashes = [];
    proof.photoHashes.push(hash);

    let txId: string | null = null;
    try {
      const anchorResult = await this.sorobanService.anchorHash(orderId, hash);
      txId = anchorResult.transactionHash;
      proof.blockchainTxHash = txId;
    } catch (error) {
      this.logger.warn(`On-chain anchoring failed for order ${orderId}: ${error.message}`);
    }

    await this.proofRepo.save(proof);

    return {
      success: true,
      message: 'Delivery proof photo uploaded and anchored',
      data: {
        orderId,
        sha256Hash: hash,
        storageUrl,
        transactionId: txId,
        audit: auditMeta,
      },
    };
  }

  async create(dto: CreateDeliveryProofDto): Promise<DeliveryProofEntity> {
    this.assertEvidenceDigestReferences(dto.evidenceDigestReferences);

    if (!dto.requestId) {
      throw new BadRequestException('requestId is required for delivery proof binding');
    }

    const pickupTimestamp = new Date(dto.pickupTimestamp);
    const deliveredAt = new Date(dto.deliveredAt);
    const signedAt = new Date(dto.signedAt);

    if (deliveredAt < pickupTimestamp) {
      throw new BadRequestException(
        'deliveredAt must be after pickupTimestamp',
      );
    }
    if (signedAt > new Date()) {
      throw new BadRequestException('signedAt cannot be in the future');
    }
    if (!dto.temperatureReadings || dto.temperatureReadings.length === 0) {
      throw new BadRequestException(
        'At least one temperature reading is required',
      );
    }

    // Require all custody handoffs confirmed before delivery can be recorded (#380)
    await this.custodyService.assertCustodyComplete(dto.orderId);

    const trustedSigner = this.resolveTrustedSigner(dto.signerKeyId);
    if (trustedSigner.publicKey !== dto.signerPublicKey) {
      throw new BadRequestException('Signer key does not match trusted rotation set');
    }

    const signedPayload = this.buildSignedPayload({
      deliveryId: dto.deliveryId,
      orderId: dto.orderId,
      requestId: dto.requestId,
      riderId: dto.riderId,
      signerRole: dto.signerRole,
      signedAt: dto.signedAt,
      evidenceDigestReferences: dto.evidenceDigestReferences,
    });
    const payloadDigest = crypto.createHash('sha256').update(signedPayload).digest('hex');
    try {
      const keypair = Keypair.fromPublicKey(dto.signerPublicKey);
      const signatureBytes = Buffer.from(dto.signature, 'base64');
      const digestBytes = Buffer.from(payloadDigest, 'hex');
      if (!keypair.verify(digestBytes, signatureBytes)) {
        throw new BadRequestException('Signature verification failed');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Signature verification failed');
    }

    const isTemperatureCompliant = dto.temperatureReadings.every(
      (t) => t >= TEMP_MIN_CELSIUS && t <= TEMP_MAX_CELSIUS,
    );

    const trustedTimestampAt = new Date();
    const timestampAnchorHash =
      dto.externalTimestampAnchorHash ??
      crypto
        .createHash('sha256')
        .update(`${dto.deliveryId}:${dto.requestId}:${trustedTimestampAt.toISOString()}`)
        .digest('hex');

    const proof = this.proofRepo.create({
      deliveryId: dto.deliveryId,
      orderId: dto.orderId,
      requestId: dto.requestId,
      riderId: dto.riderId,
      pickupTimestamp,
      pickupLocationHash: dto.pickupLocationHash ?? null,
      deliveredAt,
      deliveryLocationHash: dto.deliveryLocationHash ?? null,
      recipientName: dto.recipientName,
      recipientSignatureUrl: dto.recipientSignatureUrl ?? null,
      recipientSignatureHash: dto.recipientSignatureHash ?? null,
      photoUrl: dto.photoUrl ?? null,
      photoHashes: dto.photoHashes ?? [],
      temperatureReadings: dto.temperatureReadings,
      temperatureCelsius: dto.temperatureCelsius ?? null,
      notes: dto.notes ?? null,
      isTemperatureCompliant,
      verified: true,
      signerKeyId: dto.signerKeyId,
      signerPublicKey: dto.signerPublicKey,
      signerRole: dto.signerRole,
      signedAt,
      proofSignature: dto.signature,
      proofPayloadDigest: payloadDigest,
      trustedTimestampAt,
      timestampAnchorHash,
      evidenceDigestReferences: dto.evidenceDigestReferences,
    });

    return this.proofRepo.save(proof);
  }

  async getDeliveryProof(id: string): Promise<DeliveryProofEntity> {
    const proof = await this.proofRepo.findOne({ where: { id } });
    if (!proof) throw new NotFoundException(`Delivery proof '${id}' not found`);
    return proof;
  }

  async getProofsByRider(
    riderId: string,
    query: DeliveryProofQueryDto,
  ): Promise<PaginatedResponse<DeliveryProofEntity>> {
    return this.queryProofs({ ...query, riderId });
  }

  async getProofsByRequest(
    requestId: string,
    query: DeliveryProofQueryDto,
  ): Promise<PaginatedResponse<DeliveryProofEntity>> {
    return this.queryProofs({ ...query, requestId });
  }

  async queryProofs(
    query: DeliveryProofQueryDto,
  ): Promise<PaginatedResponse<DeliveryProofEntity>> {
    const { page = 1, pageSize = 25 } = query;
    const qb = this.proofRepo.createQueryBuilder('proof');

    if (query.riderId) {
      qb.andWhere('proof.riderId = :riderId', { riderId: query.riderId });
    }
    if (query.requestId) {
      qb.andWhere('proof.requestId = :requestId', { requestId: query.requestId });
    }
    if (query.startDate) {
      qb.andWhere('proof.deliveredAt >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('proof.deliveredAt <= :endDate', { endDate: query.endDate });
    }
    if (query.temperatureCompliantOnly) {
      qb.andWhere('proof.isTemperatureCompliant = true');
    }

    qb.orderBy('proof.deliveredAt', 'DESC');
    qb.skip(PaginationUtil.calculateSkip(page, pageSize));
    qb.take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return PaginationUtil.createResponse(data, page, pageSize, total);
  }

  isTemperatureCompliant(temperatureCelsius: number): boolean {
    return (
      temperatureCelsius >= TEMP_MIN_CELSIUS &&
      temperatureCelsius <= TEMP_MAX_CELSIUS
    );
  }

  async getDeliveryStatistics(
    riderId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DeliveryStatistics> {
    const qb = this.proofRepo.createQueryBuilder('proof');

    if (riderId) qb.andWhere('proof.riderId = :riderId', { riderId });
    if (startDate) qb.andWhere('proof.deliveredAt >= :startDate', { startDate });
    if (endDate) qb.andWhere('proof.deliveredAt <= :endDate', { endDate });

    const proofs = await qb.getMany();

    const totalDeliveries = proofs.length;
    const successfulDeliveries = proofs.length;
    const successRate = this.calculateSuccessRate(successfulDeliveries, totalDeliveries);

    const compliant = proofs.filter((p) => p.isTemperatureCompliant);
    const temperatureComplianceRate = this.calculateSuccessRate(
      compliant.length,
      totalDeliveries,
    );

    const withTemp = proofs.filter((p) => p.temperatureCelsius !== null);
    const averageTemperatureCelsius =
      withTemp.length > 0
        ? withTemp.reduce((sum, p) => sum + p.temperatureCelsius!, 0) / withTemp.length
        : null;

    return {
      totalDeliveries,
      successfulDeliveries,
      successRate,
      temperatureCompliantDeliveries: compliant.length,
      temperatureComplianceRate,
      averageTemperatureCelsius:
        averageTemperatureCelsius !== null
          ? Math.round(averageTemperatureCelsius * 100) / 100
          : null,
    };
  }

  calculateSuccessRate(successful: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((successful / total) * 10000) / 100;
  }

  private resolveTrustedSigner(kid: string): TrustedSignerKey {
    const activeKid = this.configService.get<string>('DELIVERY_PROOF_SIGNER_KID', 'delivery-proof-key-1');
    const activePublicKey = this.configService.get<string>('DELIVERY_PROOF_SIGNER_PUBLIC_KEY');
    const previousKid = this.configService.get<string>('DELIVERY_PROOF_PREVIOUS_SIGNER_KID');
    const previousPublicKey = this.configService.get<string>('DELIVERY_PROOF_PREVIOUS_SIGNER_PUBLIC_KEY');

    if (kid === activeKid && activePublicKey) {
      return { kid: activeKid, publicKey: activePublicKey };
    }
    if (previousKid && kid === previousKid && previousPublicKey) {
      return { kid: previousKid, publicKey: previousPublicKey };
    }

    throw new BadRequestException('Unknown proof signer key id');
  }

  private buildSignedPayload(input: {
    deliveryId: number;
    orderId: string;
    requestId: string;
    riderId: string;
    signerRole: string;
    signedAt: string;
    evidenceDigestReferences: string[];
  }): string {
    const canonical = {
      deliveryId: input.deliveryId,
      orderId: input.orderId,
      requestId: input.requestId,
      riderId: input.riderId,
      signerRole: input.signerRole,
      signedAt: input.signedAt,
      evidenceDigestReferences: [...input.evidenceDigestReferences].sort(),
    };

    return JSON.stringify(canonical);
  }

  private assertEvidenceDigestReferences(digests: string[]): void {
    if (!digests || digests.length === 0) {
      throw new BadRequestException('At least one evidence digest reference is required');
    }

    const invalidDigest = digests.find((digest) => !/^[a-f0-9]{64}$/i.test(digest));
    if (invalidDigest) {
      throw new BadRequestException('Evidence digest references must be 64-character hex values');
    }
  }
}
