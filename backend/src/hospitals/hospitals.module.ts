import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HospitalCapacityConfigEntity } from './entities/hospital-capacity-config.entity';
import { HospitalOverrideAuditEntity } from './entities/hospital-override-audit.entity';
import { HospitalEntity } from './entities/hospital.entity';
import { HospitalsController } from './hospitals.controller';
import { HospitalsService } from './hospitals.service';
import { HospitalIntakeWindowService } from './services/hospital-intake-window.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HospitalEntity,
      HospitalCapacityConfigEntity,
      HospitalOverrideAuditEntity,
    ]),
  ],
  controllers: [HospitalsController],
  providers: [HospitalsService, HospitalIntakeWindowService],
  exports: [HospitalsService, HospitalIntakeWindowService],
})
export class HospitalsModule {}
