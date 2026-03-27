import { Controller, Get, Post, Body, Query } from '@nestjs/common';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { RiderSearchDto, RiderAssignmentDto } from '../dto/rider-search.dto';
import { RiderSearchService } from '../services/rider-search.service';

@Controller('riders')
export class RiderSearchController {
  constructor(private readonly riderSearchService: RiderSearchService) {}

  @RequirePermissions(Permission.VIEW_RIDERS)
  @Get('search')
  async searchRiders(@Query() searchDto: RiderSearchDto) {
    return this.riderSearchService.searchRiders(searchDto);
  }

  @RequirePermissions(Permission.ASSIGN_RIDER)
  @Post('assign')
  async findRidersForAssignment(@Body() assignmentDto: RiderAssignmentDto) {
    return this.riderSearchService.findRidersForAssignment(assignmentDto);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @Get('statistics')
  async getRiderStatistics(@Query('riderId') riderId: string) {
    return this.riderSearchService.getRiderStatistics(riderId);
  }
}
