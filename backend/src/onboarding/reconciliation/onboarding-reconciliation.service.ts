import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';

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
   * Periodically check for onboardings stuck in APPROVED status (activation
   * submitted but never confirmed). Runs every 15 minutes.
   */
  @Cron('0 */15 * * * *')
  async reconcileStuckOnboardings() {
    this.logger.log('Running onboarding reconciliation task...');

    // Find onboardings in APPROVED status that haven't been updated for 10 minutes
    const stuckThreshold = new Date(Date.now() - 10 * 60 * 1000);
    const stuckOnboardings = await this.onboardingRepo.find({
      where: {
        status: OnboardingStatus.APPROVED,
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
    if (!onboarding.contractTxHash) {
      this.logger.error(`Onboarding ${onboarding.id} is APPROVED but has no contractTxHash`);
      return;
    }

    const jobStatus = await this.blockchainService.getJobStatus(onboarding.contractTxHash);

    if (!jobStatus) {
      this.logger.error(`Could not find blockchain job status for onboarding ${onboarding.id} (job: ${onboarding.contractTxHash})`);
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
      });
    } else if (jobStatus.status === 'failed' || jobStatus.status === 'dlq') {
      // Job failed or moved to DLQ
      this.logger.warn(`Onboarding ${onboarding.id} sync job failed. Marking for manual review.`);

      await this.orgRepo.update(onboarding.organizationId!, {
        verificationStatus: VerificationStatus.SYNC_FAILED,
      });
    } else {
      // Job is still pending or active
      this.logger.debug(`Onboarding ${onboarding.id} sync job is still ${jobStatus.status}. Skipping.`);
    }
  }
}
