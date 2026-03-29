import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DonationEntity } from '../donations/entities/donation.entity';
import { DisputeEntity } from '../disputes/entities/dispute.entity';
import { SorobanModule } from '../soroban/soroban.module';

import { ReconciliationRunEntity } from './entities/reconciliation-run.entity';
import { ReconciliationMismatchEntity } from './entities/reconciliation-mismatch.entity';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReconciliationRunEntity,
      ReconciliationMismatchEntity,
      DonationEntity,
      DisputeEntity,
    ]),
    SorobanModule,
  ],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
