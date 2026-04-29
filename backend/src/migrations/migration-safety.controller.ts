import { Controller, Get, Post, Body } from '@nestjs/common';
import { MigrationPreflightService } from './migration-preflight.service';
import { MigrationIntegrityService } from './migration-integrity.service';
import { MigrationRepairService } from './migration-repair.service';

@Controller('admin/migration-safety')
export class MigrationSafetyController {
  constructor(
    private readonly preflight: MigrationPreflightService,
    private readonly integrity: MigrationIntegrityService,
    private readonly repair: MigrationRepairService,
  ) {}

  @Get('preflight')
  runPreflight() {
    return this.preflight.runPreflight();
  }

  @Get('integrity')
  getIntegrityReport() {
    return this.integrity.generateReport();
  }

  @Post('repair/standard')
  runStandardRepairs() {
    return this.repair.runStandardRepairs();
  }

  @Post('repair/column')
  ensureColumn(@Body() body: { table: string; column: string; definition: string }) {
    return this.repair.ensureColumnExists(body.table, body.column, body.definition);
  }
}
