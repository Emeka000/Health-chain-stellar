import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlockchainModule } from '../blockchain/blockchain.module';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationRepository } from '../organizations/organizations.repository';
import { ReadinessModule } from '../readiness/readiness.module';
import { SorobanModule } from '../soroban/soroban.module';

import { PartnerOnboardingEntity } from './entities/partner-onboarding.entity';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingSyncListener } from './listeners/onboarding-sync.listener';
import { OnboardingReconciliationService } from './reconciliation/onboarding-reconciliation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PartnerOnboardingEntity, OrganizationEntity]),
    SorobanModule,
    ReadinessModule,
    BlockchainModule,
  ],
  controllers: [OnboardingController],
  providers: [
    OnboardingService,
    OrganizationRepository,
    OnboardingSyncListener,
    OnboardingReconciliationService,
  ],
  exports: [OnboardingService],
})
export class OnboardingModule {}
