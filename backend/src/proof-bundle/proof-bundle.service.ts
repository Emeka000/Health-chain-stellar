import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

import { DeliveryProofService } from '../delivery-proof/delivery-proof.service';
import { ValidateProofBundleDto } from './dto/validate-proof-bundle.dto';
import {
  ManifestArtifact,
  ProofBundleEntity,
  ProofBundleStatus,
} from './entities/proof-bundle.entity';

export interface VerificationReport {
  valid: boolean;
  failures: string[];
  manifestRootDigest: string | null;
  artifactResults: Array<{ type: string; seq: number; digestMatch: boolean }>;
  verifiedAt: string;
  verifierIdentity: string | null;
}

export interface ValidationResult {
  valid: boolean;
  failures: string[];
  bundle: ProofBundleEntity;
  report: VerificationReport;
}

/** Required artifact types in the canonical manifest */
const REQUIRED_ARTIFACT_TYPES = ['signature', 'photo', 'medical', 'delivery'] as const;

@Injectable()
export class ProofBundleService {
  private readonly logger = new Logger(ProofBundleService.name);

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

    // 5. Build canonical delivery hash
    const deliveryHash = this.hashRecord({
      id: proof.id,
      orderId: proof.orderId,
      riderId: proof.riderId,
      deliveredAt: proof.deliveredAt,
      recipientName: proof.recipientName,
    });

    // 6. Build and validate manifest
    const { manifest, manifestRootDigest, artifactResults, manifestFailures } =
      this.buildAndValidateManifest(dto, deliveryHash);
    failures.push(...manifestFailures);

    const verifiedAt = new Date().toISOString();
    const verifierIdentity = dto.verifierIdentity ?? dto.submittedBy;

    const report: VerificationReport = {
      valid: failures.length === 0,
      failures,
      manifestRootDigest,
      artifactResults,
      verifiedAt,
      verifierIdentity,
    };

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
      manifest,
      manifestRootDigest,
      verifierIdentity,
      verificationReport: report as unknown as Record<string, unknown>,
    });

    const saved = await this.bundleRepo.save(bundle);
    this.logger.log(
      `Proof bundle ${saved.id} ${status} — ${failures.length} failure(s) — verifier: ${verifierIdentity}`,
    );

    return { valid: status === ProofBundleStatus.VALIDATED, failures, bundle: saved, report };
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

  /**
   * Verify an existing bundle's manifest integrity.
   * Returns the stored verification report plus a re-computed root digest check.
   */
  async verifyBundle(id: string): Promise<{ intact: boolean; details: Record<string, unknown> }> {
    const bundle = await this.getOne(id);

    if (!bundle.manifest || !bundle.manifestRootDigest) {
      return { intact: false, details: { reason: 'No manifest stored for this bundle' } };
    }

    const recomputed = this.computeManifestRootDigest(bundle.manifest);
    const intact = recomputed === bundle.manifestRootDigest;

    return {
      intact,
      details: {
        storedRootDigest: bundle.manifestRootDigest,
        recomputedRootDigest: recomputed,
        status: bundle.status,
        verificationReport: bundle.verificationReport,
      },
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private buildAndValidateManifest(
    dto: ValidateProofBundleDto,
    deliveryHash: string,
  ): {
    manifest: ManifestArtifact[];
    manifestRootDigest: string;
    artifactResults: Array<{ type: string; seq: number; digestMatch: boolean }>;
    manifestFailures: string[];
  } {
    const failures: string[] = [];

    // Build canonical artifact map from known hashes
    const knownDigests: Record<string, string> = {
      signature: dto.signatureHash,
      photo: dto.photoHash,
      medical: dto.medicalHash,
      delivery: deliveryHash,
    };

    // If caller provided explicit artifacts, validate them; otherwise build from known hashes
    const artifacts = dto.artifacts ?? this.buildDefaultArtifacts(knownDigests);

    // Validate ordering: seq values must be unique and contiguous starting at 0
    const seqs = artifacts.map((a) => a.seq).sort((a, b) => a - b);
    const hasGaps = seqs.some((s, i) => s !== i);
    if (hasGaps) {
      failures.push('Manifest artifact sequence numbers must be contiguous starting at 0');
    }

    // Validate each artifact digest against known values
    const artifactResults: Array<{ type: string; seq: number; digestMatch: boolean }> = [];
    for (const artifact of artifacts) {
      const expected = knownDigests[artifact.type];
      const digestMatch = expected !== undefined ? artifact.digest === expected : true;
      if (!digestMatch) {
        failures.push(`Artifact '${artifact.type}' digest mismatch (seq ${artifact.seq})`);
      }
      artifactResults.push({ type: artifact.type, seq: artifact.seq, digestMatch });
    }

    // Ensure all required artifact types are present
    const presentTypes = new Set(artifacts.map((a) => a.type));
    for (const required of REQUIRED_ARTIFACT_TYPES) {
      if (!presentTypes.has(required)) {
        failures.push(`Required artifact type '${required}' is missing from manifest`);
      }
    }

    // Sort by seq for canonical ordering before computing root digest
    const sortedManifest = [...artifacts].sort((a, b) => a.seq - b.seq);
    const manifestRootDigest = this.computeManifestRootDigest(sortedManifest);

    return { manifest: sortedManifest, manifestRootDigest, artifactResults, manifestFailures: failures };
  }

  private buildDefaultArtifacts(digests: Record<string, string>): ManifestArtifact[] {
    return Object.entries(digests).map(([type, digest], seq) => ({ type, digest, seq }));
  }

  /** Deterministic root digest: SHA-256 of JSON-serialized sorted manifest */
  private computeManifestRootDigest(manifest: ManifestArtifact[]): string {
    const canonical = manifest
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((a) => `${a.seq}:${a.type}:${a.digest}`)
      .join('\n');
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  private hashRecord(data: Record<string, unknown>): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }
}
