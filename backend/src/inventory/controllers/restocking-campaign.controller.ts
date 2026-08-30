import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { CreateCampaignDto } from '../dto/create-campaign.dto';
import { RestockingCampaignService } from '../services/restocking-campaign.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory/campaigns')
export class RestockingCampaignController {
  constructor(private readonly campaignService: RestockingCampaignService) {}

  @RequirePermissions(Permission.MANAGE_INVENTORY)
  @ApiOperation({ summary: 'Post' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post()
  create(@Body() dto: CreateCampaignDto) {
    return this.campaignService.createCampaign(dto);
  }

  @RequirePermissions(Permission.MANAGE_INVENTORY)
  @ApiOperation({ summary: 'Get' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get()
  list(@Query('bloodBankId') bloodBankId?: string) {
    return this.campaignService.listCampaigns(bloodBankId);
  }

  @RequirePermissions(Permission.MANAGE_INVENTORY)
  @ApiOperation({ summary: 'Post :id convert' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/convert')
  recordConversion(@Param('id') id: string) {
    return this.campaignService.recordConversion(id);
  }
}
