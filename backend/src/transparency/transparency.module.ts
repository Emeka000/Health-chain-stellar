import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BloodUnitEntity } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';

import { TransparencyController } from './transparency.controller';
import { TransparencyService } from './transparency.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderEntity, OrganizationEntity, BloodUnitEntity]),
  ],
  controllers: [TransparencyController],
  providers: [TransparencyService],
})
export class TransparencyModule {}
