import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BloodUnitEntity } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';

import { TransparencyController } from './transparency.controller';
import { TransparencyPublicationEntity } from './entities/transparency-publication.entity';
import { TransparencyService } from './transparency.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      OrganizationEntity,
      BloodUnitEntity,
      TransparencyPublicationEntity,
    ]),
  ],
  controllers: [TransparencyController],
  providers: [TransparencyService],
})
export class TransparencyModule {}
