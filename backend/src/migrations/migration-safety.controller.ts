import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MigrationPreflightService } from './migration-preflight.service';
import { MigrationIntegrityService } from './migration-integrity.service';
import { MigrationRepairService } from './migration-repair.service';

@ApiTags('Migration Safety')
@ApiBearerAuth()
@Controller('admin/migration-safety')
export class MigrationSafetyController {
  constructor(
    private readonly preflight: MigrationPreflightService,
    private readonly integrity: MigrationIntegrityService,
    private readonly repair: MigrationRepairService,
  ) {}

  @ApiOperation({ summary: 'Get preflight' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('preflight')
  runPreflight() {
    return this.preflight.runPreflight();
  }

  @ApiOperation({ summary: 'Get integrity' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('integrity')
  getIntegrityReport() {
    return this.integrity.generateReport();
  }

  @ApiOperation({ summary: 'Post repair standard' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('repair/standard')
  runStandardRepairs() {
    return this.repair.runStandardRepairs();
  }

  @ApiOperation({ summary: 'Post repair column' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('repair/column')
  ensureColumn(@Body() body: { table: string; column: string; definition: string }) {
    return this.repair.ensureColumnExists(body.table, body.column, body.definition);
  }
}
