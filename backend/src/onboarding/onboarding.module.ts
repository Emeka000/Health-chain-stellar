import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationRepository } from '../organizations/organizations.repository';
import { ReadinessModule } from '../readiness/readiness.module';
import { SorobanModule } from '../soroban/soroban.module';

import { PartnerOnboardingEntity } from './entities/partner-onboarding.entity';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PartnerOnboardingEntity, OrganizationEntity]),
    SorobanModule,
    ReadinessModule,
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService, OrganizationRepository],
  exports: [OnboardingService],
})
export class OnboardingModule {}
