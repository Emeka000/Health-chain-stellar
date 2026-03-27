import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RedisModule } from '../../redis/redis.module';
import { OrganizationEntity } from '../entities/organization.entity';
import { InventoryStockEntity } from '../../inventory/entities/inventory-stock.entity';
import { BloodRequestEntity } from '../../blood-requests/entities/blood-request.entity';
import { OrderEntity } from '../../orders/entities/order.entity';
import { OrgStatsController } from './org-stats.controller';
import { OrgStatsService } from './org-stats.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationEntity,
      InventoryStockEntity,
      BloodRequestEntity,
      OrderEntity,
    ]),
    RedisModule,
  ],
  controllers: [OrgStatsController],
  providers: [OrgStatsService],
  exports: [OrgStatsService],
})
export class OrgStatsModule {}
