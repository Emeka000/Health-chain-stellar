import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InventoryStockEntity } from '../inventory/entities/inventory-stock.entity';
import { RiderEntity } from '../riders/entities/rider.entity';
import { HospitalEntity } from '../hospitals/entities/hospital.entity';
import { NotificationsModule } from '../notifications/notifications.module';

import { SurgeRuleEntity } from './entities/surge-rule.entity';
import { SurgeScenarioEntity } from './entities/surge-scenario.entity';
import { SurgeSimulationController } from './surge-simulation.controller';
import { SurgeSimulationService } from './surge-simulation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryStockEntity, RiderEntity, SurgeRuleEntity, HospitalEntity, SurgeScenarioEntity]),
    NotificationsModule,
  ],
  controllers: [SurgeSimulationController],
  providers: [SurgeSimulationService],
  exports: [SurgeSimulationService],
})
export class SurgeSimulationModule {}
