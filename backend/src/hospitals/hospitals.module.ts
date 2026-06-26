import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HospitalsController } from './hospitals.controller';
import { HospitalsService } from './hospitals.service';
import { HospitalEntity } from './entities/hospital.entity';
import { HospitalCapacityConfigEntity } from './entities/hospital-capacity-config.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([HospitalEntity, HospitalCapacityConfigEntity]),
  ],
  controllers: [HospitalsController],
  providers: [HospitalsService],
  exports: [HospitalsService],
})
export class HospitalsModule {}
