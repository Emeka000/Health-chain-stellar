import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeePolicyController } from './fee-policy.controller';
import { FeePolicyEntity } from './fee-policy.entity';
import { FeePolicyService } from './fee-policy.service';

@Module({
  imports: [TypeOrmModule.forFeature([FeePolicyEntity])],
  controllers: [FeePolicyController],
  providers: [FeePolicyService],
  exports: [FeePolicyService],
})
export class FeePolicyModule {}
