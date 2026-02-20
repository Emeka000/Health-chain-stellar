import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BloodUnitsController } from './blood-units.controller';
import { BloodUnitsService } from './blood-units.service';
import { SorobanModule } from '../soroban/soroban.module';
import { BloodUnitTrail } from '../soroban/entities/blood-unit-trail.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BloodUnitTrail]), SorobanModule],
  controllers: [BloodUnitsController],
  providers: [BloodUnitsService],
  exports: [BloodUnitsService],
})
export class BloodUnitsModule {}
