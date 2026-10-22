import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BloodUnitEntity } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { DonationEntity } from '../donations/entities/donation.entity';
import { PledgeEntity } from '../donations/entities/pledge.entity';

import { DonorImpactController } from './donor-impact.controller';
import { DonorImpactService } from './donor-impact.service';
import { AttributionService } from './attribution.service';
import { DonationAttributionEntity } from './entities/donation-attribution.entity';
import { LineageGapEntity } from './entities/lineage-gap.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BloodUnitEntity,
      OrderEntity,
      DonationEntity,
      PledgeEntity,
      DonationAttributionEntity,
      LineageGapEntity,
    ]),
  ],
  controllers: [DonorImpactController],
  providers: [DonorImpactService, AttributionService],
  exports: [DonorImpactService, AttributionService],
})
export class DonorImpactModule {}
