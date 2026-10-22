import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { FeePolicyController } from './fee-policy.controller';
import { FeePolicyService } from './fee-policy.service';
import { FeePolicyAnalyzerService } from './fee-policy-analyzer.service';
import { FeePolicyRolloutService } from './fee-policy-rollout.service';
import { FeePolicyEntity } from './entities/fee-policy.entity';

@Module({
    imports: [TypeOrmModule.forFeature([FeePolicyEntity]), ConfigModule],
    controllers: [FeePolicyController],
    providers: [FeePolicyService, FeePolicyAnalyzerService, FeePolicyRolloutService],
    exports: [FeePolicyService, FeePolicyAnalyzerService, FeePolicyRolloutService],
})
export class FeePolicyModule { }
