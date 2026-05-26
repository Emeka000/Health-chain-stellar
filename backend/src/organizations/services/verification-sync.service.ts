import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SorobanService } from '../../soroban/soroban.service';
import { OrganizationEntity } from '../entities/organization.entity';
import { VerificationSyncStatus, VerificationSource } from '../enums/verification-sync-status.enum';
import { OrganizationRepository } from '../organizations.repository';
import { VerificationSyncStatusDto } from '../dto/verification-sync-status.dto';

interface VerificationSyncPayload {
  organizationId: string;
  licenseNumber: string;
  name: string;
  orgType: 'BloodBank' | 'Hospital';
}

@Injectable()
export class VerificationSyncService {
  private readonly logger = new Logger(VerificationSyncService.name);
  private readonly MAX_RETRY_ATTEMPTS = 5;
  private readonly SYNC_TIMEOUT_MS = 120_000; // 2 minutes

  constructor(
    private readonly orgRepo: OrganizationRepository,
    private readonly sorobanService: SorobanService,
  ) {}

  /**
   * Initiate verification sync to Soroban for an approved organization
   */
  async syncVerificationToBlockchain(
    organizationId: string,
  ): Promise<{ transactionHash: string; syncStatus: string }> {
    const org = await this.orgRepo.findActiveOne({ where: { id: organizationId } });
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }

    if (!org.verifiedAt) {
      throw new BadRequestException(
        `Organization must be verified before syncing to blockchain`,
      );
    }

    // Mark as syncing
    org.syncStatus = VerificationSyncStatus.SYNCING;
    org.syncRetryCount = 0;
    await this.orgRepo.save(org);

    try {
      // Submit to Soroban
      const result = await this.sorobanService.verifyOrganization(org.id);

      // Update organization with sync success
      org.syncStatus = VerificationSyncStatus.SYNCED;
      org.verificationTxHash = result.transactionHash;
      org.syncedAt = new Date();
      org.sorobanVerifiedAt = new Date();
      org.verificationSource = VerificationSource.BACKEND;
      await this.orgRepo.save(org);

      this.logger.log(
        `Organization ${org.id} verified on-chain: ${result.transactionHash}`,
      );

      return {
        transactionHash: result.transactionHash,
        syncStatus: VerificationSyncStatus.SYNCED,
      };
    } catch (error) {
      org.syncStatus = VerificationSyncStatus.FAILED;
      org.syncErrorMessage = error instanceof Error ? error.message : String(error);
      org.syncRetryCount = (org.syncRetryCount ?? 0) + 1;
      await this.orgRepo.save(org);

      this.logger.error(
        `Failed to sync verification for org ${org.id}: ${org.syncErrorMessage}`,
      );

      throw error;
    }
  }

  /**
   * Revoke verification from Soroban
   */
  async revokeVerificationFromBlockchain(
    organizationId: string,
    reason: string,
  ): Promise<{ transactionHash: string; syncStatus: string }> {
    const org = await this.orgRepo.findActiveOne({ where: { id: organizationId } });
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }

    if (!org.verifiedAt) {
      throw new BadRequestException('Organization is not verified');
    }

    org.syncStatus = VerificationSyncStatus.SYNCING;
    await this.orgRepo.save(org);

    try {
      const result = await this.sorobanService.revokeOrganizationVerification(
        org.id,
        reason,
      );

      // Update organization with revocation
      org.verifiedAt = null;
      org.verifiedByUserId = null;
      org.syncStatus = VerificationSyncStatus.SYNCED;
      org.verificationTxHash = result.transactionHash;
      org.syncedAt = new Date();
      org.sorobanVerifiedAt = null;
      await this.orgRepo.save(org);

      this.logger.log(
        `Organization ${org.id} verification revoked on-chain: ${result.transactionHash}`,
      );

      return {
        transactionHash: result.transactionHash,
        syncStatus: VerificationSyncStatus.SYNCED,
      };
    } catch (error) {
      org.syncStatus = VerificationSyncStatus.FAILED;
      org.syncErrorMessage = error instanceof Error ? error.message : String(error);
      org.syncRetryCount = (org.syncRetryCount ?? 0) + 1;
      await this.orgRepo.save(org);

      this.logger.error(
        `Failed to revoke verification for org ${org.id}: ${org.syncErrorMessage}`,
      );

      throw error;
    }
  }

  /**
   * Retry failed sync
   */
  async retrySyncVerification(organizationId: string): Promise<{ transactionHash: string }> {
    const org = await this.orgRepo.findActiveOne({ where: { id: organizationId } });
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }

    if (org.syncStatus !== VerificationSyncStatus.FAILED) {
      throw new BadRequestException(
        `Can only retry failed syncs (current status: ${org.syncStatus})`,
      );
    }

    if ((org.syncRetryCount ?? 0) >= this.MAX_RETRY_ATTEMPTS) {
      throw new BadRequestException(
        `Max retry attempts (${this.MAX_RETRY_ATTEMPTS}) exceeded`,
      );
    }

    return this.syncVerificationToBlockchain(organizationId);
  }

  /**
   * Get verification sync status
   */
  async getSyncStatus(organizationId: string): Promise<VerificationSyncStatusDto> {
    const org = await this.orgRepo.findActiveOne({ where: { id: organizationId } });
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }

    return {
      id: org.id,
      name: org.name,
      status: org.status,
      syncStatus: org.syncStatus,
      verificationSource: org.verificationSource,
      verifiedAt: org.verifiedAt,
      syncedAt: org.syncedAt,
      verificationTxHash: org.verificationTxHash,
      sorobanVerifiedAt: org.sorobanVerifiedAt,
      syncErrorMessage: org.syncErrorMessage,
      syncRetryCount: org.syncRetryCount,
    };
  }

  /**
   * List organizations with pending or failed syncs
   */
  async listPendingSyncs(): Promise<VerificationSyncStatusDto[]> {
    const orgs = await this.orgRepo.find({
      where: [
        { syncStatus: VerificationSyncStatus.PENDING },
        { syncStatus: VerificationSyncStatus.SYNCING },
        { syncStatus: VerificationSyncStatus.FAILED },
        { syncStatus: VerificationSyncStatus.MISMATCH },
      ],
    });

    return orgs.map((org) => ({
      id: org.id,
      name: org.name,
      status: org.status,
      syncStatus: org.syncStatus,
      verificationSource: org.verificationSource,
      verifiedAt: org.verifiedAt,
      syncedAt: org.syncedAt,
      verificationTxHash: org.verificationTxHash,
      sorobanVerifiedAt: org.sorobanVerifiedAt,
      syncErrorMessage: org.syncErrorMessage,
      syncRetryCount: org.syncRetryCount,
    }));
  }

  /**
   * Check for sync mismatches between backend and Soroban
   */
  async checkSyncMismatch(organizationId: string): Promise<boolean> {
    const org = await this.orgRepo.findActiveOne({ where: { id: organizationId } });
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }

    // Query Soroban for verification status
    const sorobanStatus = await this.sorobanService.getOrganizationVerificationStatus(org.id);

    const backendVerified = !!org.verifiedAt;
    const sorobanVerified = sorobanStatus?.verified ?? false;

    if (backendVerified !== sorobanVerified) {
      org.syncStatus = VerificationSyncStatus.MISMATCH;
      org.syncErrorMessage = `Backend verified: ${backendVerified}, Soroban verified: ${sorobanVerified}`;
      await this.orgRepo.save(org);
      return true;
    }

    return false;
  }
}
