import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

import { RegionScoped } from './decorators/region-scope.decorator';
import { CreateRegionDto } from './dto/create-region.dto';
import { QueryRegionDto } from './dto/query-region.dto';
import { RegionScopeGuard } from './guards/region-scope.guard';
import { RegionsService } from './regions.service';

@ApiTags('Regions')
@ApiBearerAuth()
@Controller('regions')
@UseGuards(PermissionsGuard, RegionScopeGuard)
export class RegionsController {
  constructor(private readonly regionsService: RegionsService) {}

  @ApiOperation({ summary: 'Post' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post()
  @RequirePermissions(Permission.MANAGE_REGIONS)
  create(@Body() dto: CreateRegionDto) {
    return this.regionsService.create(dto);
  }

  @ApiOperation({ summary: 'Get' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get()
  @RegionScoped()
  @RequirePermissions(Permission.VIEW_REGIONS)
  findAll(@Query() query: QueryRegionDto) {
    return this.regionsService.findAll(query);
  }

  @ApiOperation({ summary: 'Get :id' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id')
  @RegionScoped()
  @RequirePermissions(Permission.VIEW_REGIONS)
  async findOne(@Param('id') id: string, @Req() req: any) {
    await this.assertRegionInScope(id, req);
    return this.regionsService.findOne(id);
  }

  @ApiOperation({ summary: 'Patch :id' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id')
  @RegionScoped()
  @RequirePermissions(Permission.MANAGE_REGIONS)
  async update(@Param('id') id: string, @Body() dto: Partial<CreateRegionDto>, @Req() req: any) {
    await this.assertRegionInScope(id, req);
    return this.regionsService.update(id, dto);
  }

  @ApiOperation({ summary: 'Patch :id deactivate' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/deactivate')
  @RegionScoped()
  @RequirePermissions(Permission.MANAGE_REGIONS)
  async deactivate(@Param('id') id: string, @Req() req: any) {
    await this.assertRegionInScope(id, req);
    return this.regionsService.deactivate(id);
  }

  private async assertRegionInScope(id: string, req: any): Promise<void> {
    const scope = req?.regionScope;
    if (!scope) {
      return;
    }
    const region = await this.regionsService.findOne(id);
    const regionCode = (region as any)?.code ?? (region as any)?.regionCode;
    if (regionCode !== scope) {
      throw new ForbiddenException('Region is outside your scope');
    }
  }
}
