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

/* … truncated 1899 chars — edit only what you need near the top … */
