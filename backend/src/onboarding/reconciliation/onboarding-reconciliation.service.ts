import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';

import { OnChainTxStatus } from '../../blockchain/entities/on-chain-tx-state.entity';
import { SorobanService as BlockchainSorobanService } from '../../blockchain/services/soroban.service';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { OrganizationVerificationStatus } from '../../organizations/enums/organization-verification-status.enum';
import { VerificationStatus } from '../../organizations/enums/verification-status.enum';
import { PartnerOnboardingEntity } from '../entities/partner-onboarding.entity';
import { OnboardingStatus } from '../enums/onboarding.enum';

@Injectable()
export class OnboardingReconciliationService {
  private readonly logger = new Logger(OnboardingReconciliationService.name);

  constructor(
    @InjectRepository(PartnerOnboardingEntity)
    private readonly onboardingRepo: Repository<PartnerOnboardingEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    private readonly blockchainService: BlockchainSorobanService,
  ) {}

  /**
   * Periodically check for onboardings stuck in ACTIVATING status.
   * Runs every 15 minutes.
   */
  @Cron(CronExpression.EVERY_15_MINUTES)
  async reconcileStuckOnboardings() {
    this.logger.log('Running onboarding reconciliation task...');

    // Find onboardings in ACTIVATING status that haven't been updated for 10 minutes
    const stuckThreshold = new Date(Date.now() - 10 * 60 * 1000);
    const stuckOnboardings = await this.onboardingRepo.find({
      where: {
        status: OnboardingStatus.ACTIVATING,
        updatedAt: LessThan(stuckThreshold),
      },
    });

    if (stuckOnboardings.length === 0) {
      this.logger.debug('No stuck onboardings found.');
      return;
    }

    this.logger.warn(`Found ${stuckOnboardings.length} stuck onboardings. Reconciling...`);

    for (const onboarding of stuckOnboardings) {
      await this.reconcileOne(onboarding);
    }
  }

  private async reconcileOne(onboarding: PartnerOnboardingEntity) {
    if (!onboarding.activationTxId) {
      this.logger.error(`Onboarding ${onboarding.id} is ACTIVATING but has no activationTxId`);
      return;
    }

    const jobStatus = await this.blockchainService.getJobStatus(onboarding.activationTxId);

    if (!jobStatus) {
      this.logger.error(`Could not find blockchain job status for onboarding ${onboarding.id} (job: ${onboarding.activationTxId})`);
      return;
    }

    this.logger.log(`Reconciling onboarding ${onboarding.id}: job status is ${jobStatus.status}`);

    if (jobStatus.status === 'completed' && jobStatus.transactionHash) {
      // Job is done, maybe the listener missed it or the callback failed
      this.logger.log(`Onboarding ${onboarding.id} sync job completed. Finalizing manually.`);
      
      await this.orgRepo.update(onboarding.organizationId!, {
        verificationStatus: VerificationStatus.VERIFIED,
        status: OrganizationVerificationStatus.APPROVED,
        blockchainTxHash: jobStatus.transactionHash,
        verifiedAt: new Date(),
      });

      await this.onboardingRepo.update(onboarding.id, {
        status: OnboardingStatus.ACTIVATED,
        contractTxHash: jobStatus.transactionHash,
        reconciliationStatus: 'RECONCILED',
      });
    } else if (jobStatus.status === 'failed' || jobStatus.status === 'dlq') {
      // Job failed or moved to DLQ
      this.logger.warn(`Onboarding ${onboarding.id} sync job failed. Marking for manual review.`);
      
      await this.orgRepo.update(onboarding.organizationId!, {
        verificationStatus: VerificationStatus.SYNC_FAILED,
      });

      await this.onboardingRepo.update(onboarding.id, {
        reconciliationStatus: 'FAILED',
      });
    } else {
      // Job is still pending or active
      this.logger.debug(`Onboarding ${onboarding.id} sync job is still ${jobStatus.status}. Skipping.`);
    }
  }
}
