import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

import { RegionScoped } from './decorators/region-scope.decorator';
import { CreateRegionDto } from './dto/create-region.dto';
import { QueryRegionDto } from './dto/query-region.dto';
import { RegionScopeGuard } from './guards/region-scope.guard';
import { RegionsService } from './regions.service';

@Controller('regions')
@UseGuards(PermissionsGuard, RegionScopeGuard)
export class RegionsController {
  constructor(private readonly regionsService: RegionsService) {}

  @Post()
  @RequirePermissions(Permission.MANAGE_REGIONS)
  create(@Body() dto: CreateRegionDto) {
    return this.regionsService.create(dto);
  }

  @Get()
  @RegionScoped()
  @RequirePermissions(Permission.VIEW_REGIONS)
  findAll(@Query() query: QueryRegionDto) {
    return this.regionsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.VIEW_REGIONS)
  findOne(@Param('id') id: string) {
    return this.regionsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.MANAGE_REGIONS)
  update(@Param('id') id: string, @Body() dto: Partial<CreateRegionDto>) {
    return this.regionsService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @RequirePermissions(Permission.MANAGE_REGIONS)
  deactivate(@Param('id') id: string) {
    return this.regionsService.deactivate(id);
  }
}
