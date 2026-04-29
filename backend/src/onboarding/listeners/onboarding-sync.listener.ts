import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { TxFailedEvent, TxFinalEvent } from '../../events/blockchain-tx.events';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { OrganizationVerificationStatus } from '../../organizations/enums/organization-verification-status.enum';
import { VerificationStatus } from '../../organizations/enums/verification-status.enum';
import { PartnerOnboardingEntity } from '../entities/partner-onboarding.entity';
import { OnboardingStatus } from '../enums/onboarding.enum';

@Injectable()
export class OnboardingSyncListener {
  private readonly logger = new Logger(OnboardingSyncListener.name);

  constructor(
    @InjectRepository(PartnerOnboardingEntity)
    private readonly onboardingRepo: Repository<PartnerOnboardingEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
  ) {}

  @OnEvent('blockchain.tx.final')
  async handleTxFinal(event: TxFinalEvent) {
    if (event.contractMethod !== 'verify_organization') return;

    const onboardingId = event.metadata?.onboardingId as string;
    const organizationId = event.metadata?.organizationId as string;

    if (!onboardingId || !organizationId) {
      this.logger.error(
        `Missing metadata in verify_organization final event: onboardingId=${onboardingId}, organizationId=${organizationId}`,
      );
      return;
    }

    this.logger.log(`Finalizing onboarding activation for ${onboardingId}`);

    await this.orgRepo.update(organizationId, {
      verificationStatus: VerificationStatus.VERIFIED,
      status: OrganizationVerificationStatus.APPROVED,
      blockchainTxHash: event.transactionHash,
      verifiedAt: new Date(),
    });

    await this.onboardingRepo.update(onboardingId, {
      status: OnboardingStatus.ACTIVATED,
      contractTxHash: event.transactionHash,
      reconciliationStatus: 'RECONCILED',
    });
  }

  @OnEvent('blockchain.tx.failed')
  async handleTxFailed(event: TxFailedEvent) {
    if (event.contractMethod !== 'verify_organization') return;

    const onboardingId = event.metadata?.onboardingId as string;
    const organizationId = event.metadata?.organizationId as string;

    if (!onboardingId || !organizationId) return;

    this.logger.warn(
      `Blockchain verification failed for onboarding ${onboardingId}: ${event.failureReason}`,
    );

    await this.orgRepo.update(organizationId, {
      verificationStatus: VerificationStatus.SYNC_FAILED,
      rejectionReason: `Blockchain verification failed: ${event.failureReason}`,
    });

    await this.onboardingRepo.update(onboardingId, {
      reconciliationStatus: 'FAILED',
    });
  }
}
