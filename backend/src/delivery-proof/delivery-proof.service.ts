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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TrustedSignerKey {
  kid: string;
  publicKey: string;
}

/**
 * Actor context used to scope delivery-proof reads and uploads to the
 * assigned rider, the order's tenants, and admins (issue #1535).
 */
export interface DeliveryProofActor {
  userId: string;
  roles?: string[];
  permissions?: string[];
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

  /**
   * Returns true when the actor is an admin or holds an admin-level role.
   */
  private isAdmin(actor?: DeliveryProofActor): boolean {
    if (!actor) return false;
    const roles = (actor.roles ?? []).map((r) => r.toLowerCase());
    const permissions = (actor.permissions ?? []).map((p) => p.toLowerCase());
    return (
      roles.includes('admin') ||
      roles.includes('super_admin') ||
      permissions.includes('admin') ||
      permissions.includes('*') ||
      permissions.includes('delivery_proof:admin')
    );
  }

  /**
   * Asserts the actor may read the given proof. Admins may read any proof;
   * otherwise the actor must be the assigned rider or one of the order's
   * tenants (matched by userId).
   */
  private assertCanReadProof(proof: DeliveryProofEntity, actor?: DeliveryProofActor): void {
    if (this.isAdmin(actor)) return;
    if (!actor) {
      throw new NotFoundException('Delivery proof not found');
    }
    const isRider = proof.riderId === actor.userId;
    const isTenant =
      (proof as any).tenantId === actor.userId ||
      (proof as any).donorId === actor.userId ||
      (proof as any).recipientId === actor.userId;
    if (!isRider && !isTenant) {
      // Do not leak existence of proofs the actor cannot access.
      throw new NotFoundException('Delivery proof not found');
    }
  }

  /**
   * Asserts the actor may upload to the given order. Admins may upload to any
   * order; otherwise the actor must be the assigned rider or one of the
   * order's tenants.
   */
  private async assertCanUploadToOrder(orderId: string, actor?: DeliveryProofActor): Promise<void> {
    if (this.isAdmin(actor)) return;
    if (!actor) {
      throw new NotFoundException('Delivery proof not found');
    }
    const existing = await this.proofRepo.findOne({ where: { orderId } });
    if (existing) {
      const isRider = existing.riderId === actor.userId;
      const isTenant =
        (existing as any).tenantId === actor.userId ||
        (existing as any).donorId === actor.userId ||
        (existing as any).recipientId === actor.userId;
      if (!isRider && !isTenant) {
        throw new NotFoundException('Delivery proof not found');
      }
      return;
    }
    // No proof yet: only the assigned rider may create the initial proof.
    // Without an existing proof we cannot resolve the order's tenants here,
    // so deny non-admins to avoid arbitrary uploads to any order.
    throw new NotFoundException('Delivery proof not found');
  }

  async uploadPhoto(orderId: string, file: Express.Multer.File, actor?: DeliveryProofActor) {
    if (!file) throw new BadRequestException('No file uploaded');

    // Reject path-traversal payloads (e.g. "../../../tmp/x") before the value
    // is ever embedded in a file name or used as an owner id.
    if (!UUID_REGEX.test(orderId)) {
      throw new BadRequestException('orderId must be a valid UUID');
    }

    // Validate against photo policy (MIME, extension, size, content sniffing).
    this.uploadValidation.validate(file, 'photo');

    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const auditMeta = this.uploadValidation.buildAuditMetadata(file, 'photo', hash);

    const storagePath = this.configService.get<string>('STORAGE_PATH', './uploads');
    if (!fs.existsSync(storagePath)) fs.mkdirSync(storagePath, { recursive: true });

    const storageRoot = path.resolve(storagePath);
    const fileExt = path.extname(file.originalname) || '.png';
    const fileName = `dp-${orderId}-${Date.now()}${fileExt}`;
    const resolvedPath = path.resolve(storageRoot, fileName);

    // Defense-in-depth: the resolved path must stay inside the storage root.
    if (resolvedPath !== storageRoot && !resolvedPath.startsWith(storageRoot + path.sep)) {
      throw new BadRequestException('Invalid storage path');
    }

    try {
      fs.writeFileSync(resolvedPath, file.buffer);
    } catch (err) {
      this.logger.error(`Failed to write file to storage: ${err.message}`);
      throw new BadRequestException('Internal Storage Error');
    }

    const storageUrl = `${storagePath}/${fileName}`;

    await this.fileMetadata.replace({
      ownerType: FileOwnerType.DELIVERY_PROOF,
      ownerId: orderId,
      storagePath: resolvedPath,
      originalFilename: file.originalname,
      contentType: file.mimetype,
      sizeBytes: file.size,
      sha256Hash: hash,
    });

    const proof = await this.proofRepo.findOne({ where: { orderId } });
    if (!proof) {
      // A delivery proof requires a NOT NULL deliveryId; without an existing
      // proof we cannot safely auto-create one, so fail before any on-chain
      // anchoring leaves an orphan anchor for a proof that does not exist.
      throw new NotFoundException(
        `No delivery proof found for order ${orderId}`,
      );
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

  /**
   * Deterministically serialises a value so that structurally
   * identical payloads always produce the same signature input.
   */
  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((v) => this.stableStringify(v)).join(',')}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${this.stableStringify(obj[k])}`)
      .join(',')}}`;
  }

  /**
   * Builds the canonical signed payload for a delivery proof.
   */
  buildSignedPayload(proof: Partial<DeliveryProofEntity>): string {
    return this.stableStringify({
      orderId: proof.orderId,
      deliveryId: proof.deliveryId,
      riderId: proof.riderId,
      photoHashes: proof.photoHashes ?? [],
      temperatureCelsius: proof.temperatureCelsius ?? null,
      deliveredAt: proof.deliveredAt ?? null,
    });
  }

  /**
   * Resolves the trusted signer key for a given key id from configuration.
   */
  resolveTrustedSigner(kid?: string): TrustedSignerKey | null {
    const raw = this.configService.get<string>('DELIVERY_PROOF_TRUSTED_SIGNERS');
    if (!raw) return null;
    let keys: TrustedSignerKey[];
    try {
      keys = JSON.parse(raw);
    } catch {
      this.logger.warn('DELIVERY_PROOF_TRUSTED_SIGNERS is not valid JSON');
      return null;
    }
    if (!Array.isArray(keys)) return null;
    if (!kid) return keys[0] ?? null;
    return keys.find((k) => k.kid === kid) ?? null;
  }

  /**
   * Ensures every evidence digest referenced by the proof is present in the
   * stored photo hashes.
   */
  assertEvidenceDigestReferences(
    proof: Partial<DeliveryProofEntity>,
    evidenceDigests: string[] = [],
  ): void {
    const known = new Set(proof.photoHashes ?? []);
    for (const digest of evidenceDigests) {
      if (!known.has(digest)) {
        throw new BadRequestException(
          `Evidence digest ${digest} does not reference a stored photo hash`,
        );
      }
    }
  }

  /**
   * Returns true when the recorded temperature is within the compliant range.
   */
  isTemperatureCompliant(temperatureCelsius?: number | null): boolean {
    if (temperatureCelsius === null || temperatureCelsius === undefined) {
      return false;
    }
    return temperatureCelsius >= TEMP_MIN_CELSIUS && temperatureCelsius <= TEMP_MAX_CELSIUS;
  }

  /**
   * Calculates a success rate as a percentage (0-100), rounded to two decimals.
   */
  calculateSuccessRate(successful: number, total: number): number {
    if (!total || total <= 0) return 0;
    return Math.round((successful / total) * 10000) / 100;
  }

  async create(dto: CreateDeliveryProofDto, actor?: DeliveryProofActor) {
    await this.assertCanUploadToOrder(dto.orderId, actor);

    const existing = await this.proofRepo.findOne({ where: { orderId: dto.orderId } });
    if (existing) {
      throw new BadRequestException(
        `A delivery proof already exists for order ${dto.orderId}`,
      );
    }

    const proof = this.proofRepo.create({
      ...dto,
      photoHashes: dto.photoHashes ?? [],
    } as Partial<DeliveryProofEntity>);

    const saved = await this.proofRepo.save(proof);
    return saved;
  }

  async getDeliveryProof(id: string, actor?: DeliveryProofActor) {
    const proof = await this.proofRepo.findOne({ where: { id } });
    if (!proof) {
      throw new NotFoundException('Delivery proof not found');
    }
    this.assertCanReadProof(proof, actor);
    return proof;
  }

  async getOne(id: string, actor?: DeliveryProofActor) {
    return this.getDeliveryProof(id, actor);
  }

  async queryProofs(
    query: DeliveryProofQueryDto,
    actor?: DeliveryProofActor,
  ): Promise<PaginatedResponse<DeliveryProofEntity>> {
    const { page = 1, limit = 20 } = query;
    const qb = this.proofRepo.createQueryBuilder('proof');

    if (query.orderId) {
      qb.andWhere('proof.orderId = :orderId', { orderId: query.orderId });
    }
    if (query.riderId) {
      qb.andWhere('proof.riderId = :riderId', { riderId: query.riderId });
    }
    if (query.deliveryId) {
      qb.andWhere('proof.deliveryId = :deliveryId', { deliveryId: query.deliveryId });
    }

    // Non-admins only see proofs they are assigned to.
    if (!this.isAdmin(actor)) {
      if (!actor) {
        throw new NotFoundException('Delivery proof not found');
      }
      qb.andWhere('proof.riderId = :actorId', { actorId: actor.userId });
    }

    qb.orderBy('proof.createdAt', 'DESC');
    qb.skip(PaginationUtil.getOffset(page, limit)).take(limit);

    const [items, total] = await qb.getManyAndCount();
    return PaginationUtil.buildResponse(items, total, page, limit);
  }

  async query(
    query: DeliveryProofQueryDto,
    actor?: DeliveryProofActor,
  ): Promise<PaginatedResponse<DeliveryProofEntity>> {
    return this.queryProofs(query, actor);
  }

  async getProofsByRequest(orderId: string, actor?: DeliveryProofActor) {
    const proofs = await this.proofRepo.find({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
    if (!this.isAdmin(actor)) {
      for (const proof of proofs) {
        this.assertCanReadProof(proof, actor);
      }
    }
    return proofs;
  }

  async getProofsByRider(riderId: string, actor?: DeliveryProofActor) {
    if (!this.isAdmin(actor) && actor?.userId !== riderId) {
      throw new NotFoundException('Delivery proof not found');
    }
    return this.proofRepo.find({
      where: { riderId },
      order: { createdAt: 'DESC' },
    });
  }

  async getDeliveryStatistics(
    riderId?: string,
    actor?: DeliveryProofActor,
  ): Promise<DeliveryStatistics> {
    if (riderId && !this.isAdmin(actor) && actor?.userId !== riderId) {
      throw new NotFoundException('Delivery proof not found');
    }

    const qb = this.proofRepo.createQueryBuilder('proof');
    if (riderId) {
      qb.andWhere('proof.riderId = :riderId', { riderId });
    }
    const proofs = await qb.getMany();

    const totalDeliveries = proofs.length;
    const successfulDeliveries = proofs.filter((p) => p.deliveredAt != null).length;
    const temperatureCompliantDeliveries = proofs.filter((p) =>
      this.isTemperatureCompliant(p.temperatureCelsius),
    ).length;

    const temps = proofs
      .map((p) => p.temperatureCelsius)
      .filter((t): t is number => typeof t === 'number');
    const averageTemperatureCelsius = temps.length
      ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 100) / 100
      : null;

    return {
      totalDeliveries,
      successfulDeliveries,
      successRate: this.calculateSuccessRate(successfulDeliveries, totalDeliveries),
      temperatureCompliantDeliveries,
      temperatureComplianceRate: this.calculateSuccessRate(
        temperatureCompliantDeliveries,
        totalDeliveries,
      ),
      averageTemperatureCelsius,
    };
  }
}
