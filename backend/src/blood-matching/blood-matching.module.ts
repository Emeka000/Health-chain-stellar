import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BloodRequestItemEntity } from '../blood-requests/entities/blood-request-item.entity';
import { BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { InventoryStockEntity } from '../inventory/entities/inventory-stock.entity';

import { BloodMatchingController } from './controllers/blood-matching.controller';
import { BloodMatchingService } from './services/blood-matching.service';
import { BloodCompatibilityEngine } from './compatibility/blood-compatibility.engine';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BloodUnit,
      BloodRequestEntity,
      BloodRequestItemEntity,
      InventoryStockEntity,
    ]),
  ],
  controllers: [BloodMatchingController],
  providers: [BloodMatchingService, BloodCompatibilityEngine],
  exports: [BloodMatchingService, BloodCompatibilityEngine],
})
export class BloodMatchingModule {}
