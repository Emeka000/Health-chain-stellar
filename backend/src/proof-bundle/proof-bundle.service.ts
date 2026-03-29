import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

import { DeliveryProofService } from '../delivery-proof/delivery-proof.service';
import { ValidateProofBundleDto } from './dto/validate-proof-bundle.dto';
import {
  ProofBundleEntity,
  ProofBundleStatus,
} from './entities/proof-bundle.entity';

export interface ValidationResult {
  valid: boolean;
  failures: string[];
  bundle: ProofBundleEntity;
}

@Injectable()
export class ProofBundleService {
  constructor(
    @InjectRepository(ProofBundleEntity)
    private readonly bundleRepo: Repository<ProofBundleEntity>,
    private readonly deliveryProofService: DeliveryProofService,
  ) {}

  async validateAndAttach(dto: ValidateProofBundleDto): Promise<ValidationResult> {
    const proof = await this.deliveryProofService.getDeliveryProof(dto.deliveryProofId);

    const failures: string[] = [];

    // 1. Delivery proof must be verified
    if (!proof.verified) {
      failures.push('Delivery proof has not been verified');
    }

    // 2. Temperature compliance
    if (!proof.isTemperatureCompliant) {
      failures.push('Temperature readings are out of compliance range');
    }

    // 3. Signature hash must match stored hash
    if (proof.recipientSignatureHash && proof.recipientSignatureHash !== dto.signatureHash) {
      failures.push('Signature hash does not match stored delivery proof');
    }
    if (!proof.recipientSignatureHash) {
      failures.push('Recipient signature is missing from delivery proof');
    }

    // 4. Photo evidence must be present
    if (!proof.photoHashes || proof.photoHashes.length === 0) {
      failures.push('Photo evidence is missing from delivery proof');
    } else if (!proof.photoHashes.includes(dto.photoHash)) {
      failures.push('Photo hash does not match any stored photo evidence');
    }

    // 5. Derive delivery hash from the proof record for on-chain anchoring
    const deliveryHash = this.hashRecord({
      id: proof.id,
      orderId: proof.orderId,
      riderId: proof.riderId,
      deliveredAt: proof.deliveredAt,
      recipientName: proof.recipientName,
    });

    const status = failures.length === 0 ? ProofBundleStatus.VALIDATED : ProofBundleStatus.REJECTED;

    const bundle = this.bundleRepo.create({
      paymentId: dto.paymentId,
      deliveryProofId: dto.deliveryProofId,
      deliveryHash,
      signatureHash: dto.signatureHash,
      photoHash: dto.photoHash,
      medicalHash: dto.medicalHash,
      submittedBy: dto.submittedBy,
      status,
      rejectionReason: failures.length > 0 ? failures.join('; ') : null,
    });

    const saved = await this.bundleRepo.save(bundle);
    return { valid: status === ProofBundleStatus.VALIDATED, failures, bundle: saved };
  }

  async releaseEscrow(bundleId: string, releasedBy: string): Promise<ProofBundleEntity> {
    const bundle = await this.bundleRepo.findOne({ where: { id: bundleId } });
    if (!bundle) throw new NotFoundException(`Proof bundle '${bundleId}' not found`);

    if (bundle.status !== ProofBundleStatus.VALIDATED) {
      throw new BadRequestException(
        `Cannot release escrow: bundle status is '${bundle.status}'. Failures: ${bundle.rejectionReason ?? 'none'}`,
      );
    }

    if (bundle.releasedAt) {
      throw new BadRequestException('Escrow has already been released for this bundle');
    }

    bundle.releasedAt = new Date();
    return this.bundleRepo.save(bundle);
  }

  async getByPayment(paymentId: string): Promise<ProofBundleEntity[]> {
    return this.bundleRepo.find({ where: { paymentId }, order: { createdAt: 'DESC' } });
  }

  async getOne(id: string): Promise<ProofBundleEntity> {
    const bundle = await this.bundleRepo.findOne({ where: { id } });
    if (!bundle) throw new NotFoundException(`Proof bundle '${id}' not found`);
    return bundle;
  }

  private hashRecord(data: Record<string, unknown>): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }
}
