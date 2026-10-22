import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DonorDeferralEntity } from './entities/donor-deferral.entity';
import { EligibilityRuleVersionEntity } from './entities/eligibility-rule-version.entity';
import { DonorEligibilityService } from './donor-eligibility.service';
import { DonorEligibilityController } from './donor-eligibility.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([DonorDeferralEntity, EligibilityRuleVersionEntity]),
    AuthModule,
  ],
  controllers: [DonorEligibilityController],
  providers: [DonorEligibilityService],
  exports: [DonorEligibilityService],
})
export class DonorEligibilityModule {}
