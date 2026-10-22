import { Module } from '@nestjs/common';
import { MigrationPreflightService } from './migration-preflight.service';
import { MigrationIntegrityService } from './migration-integrity.service';
import { MigrationRepairService } from './migration-repair.service';
import { MigrationSafetyController } from './migration-safety.controller';

@Module({
  controllers: [MigrationSafetyController],
  providers: [MigrationPreflightService, MigrationIntegrityService, MigrationRepairService],
  exports: [MigrationPreflightService, MigrationIntegrityService, MigrationRepairService],
})
export class MigrationSafetyModule {}
