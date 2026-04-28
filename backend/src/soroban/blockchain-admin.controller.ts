import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/enums/permission.enum';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

import { SorobanService } from './soroban.service';
import { SorobanIndexerService } from './soroban-indexer.service';

@ApiTags('Blockchain Admin')
@Controller('blockchain')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BlockchainAdminController {
  constructor(
    private readonly sorobanService: SorobanService,
    private readonly indexerService: SorobanIndexerService,
  ) {}

  @Get('admin/status')
  @RequirePermissions(Permission.MANAGE_SOROBAN)
  @ApiOperation({ summary: 'Get blockchain contract status and metadata' })
  @ApiResponse({ status: 200, description: 'Contract metadata fetched successfully' })
  async getStatus() {
    const version = await this.sorobanService.getContractVersion();
    const metadata = await this.sorobanService.getContractMetadata();

    return {
      version,
      contractId: metadata.name ? 'Deployed' : 'Unknown',
      ...metadata,
      checkedAt: new Date().toISOString(),
    };
  }

  @Get('reconciliation/discrepancies')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'List unresolved on-chain/off-chain payment discrepancies (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Discrepancies retrieved successfully' })
  async getDiscrepancies(@Query('limit') limit?: string) {
    const data = await this.indexerService.getDiscrepancies(limit ? parseInt(limit, 10) : 50);
    return { data, total: data.length };
  }
}
