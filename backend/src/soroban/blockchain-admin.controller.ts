import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/enums/permission.enum';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

import { SorobanService } from './soroban.service';

@ApiTags('Blockchain Admin')
@Controller('admin/blockchain')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BlockchainAdminController {
  constructor(private readonly sorobanService: SorobanService) {}

  @Get('status')
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
}
