import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { RiderSearchDto, RiderAssignmentDto } from '../dto/rider-search.dto';
import { RiderSearchService } from '../services/rider-search.service';

@ApiTags('Riders')
@ApiBearerAuth()
@Controller('riders')
export class RiderSearchController {
  constructor(private readonly riderSearchService: RiderSearchService) {}

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get search' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('search')
  async searchRiders(@Query() searchDto: RiderSearchDto) {
    return this.riderSearchService.searchRiders(searchDto);
  }

  @RequirePermissions(Permission.ASSIGN_RIDER)
  @ApiOperation({ summary: 'Post assign' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('assign')
  async findRidersForAssignment(@Body() assignmentDto: RiderAssignmentDto) {
    return this.riderSearchService.findRidersForAssignment(assignmentDto);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get statistics' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('statistics')
  async getRiderStatistics(@Query('riderId') riderId: string) {
    return this.riderSearchService.getRiderStatistics(riderId);
  }
}
