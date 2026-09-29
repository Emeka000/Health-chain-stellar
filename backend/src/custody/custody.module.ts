import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SorobanModule } from '../soroban/soroban.module';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { CustodyController } from './custody.controller';
import { CustodyHandoffEntity } from './entities/custody-handoff.entity';
import { CustodyService } from './custody.service';

@Module({
  imports: [TypeOrmModule.forFeature([CustodyHandoffEntity, BloodUnit]), SorobanModule],
  controllers: [CustodyController],
  providers: [CustodyService],
  exports: [CustodyService],
})
export class CustodyModule {}
