import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { ActivityQueryDto } from './dto/activity-query.dto';
import { UserActivityService } from './user-activity.service';

@ApiTags('User Activity')
@ApiBearerAuth()
@Controller('activity-logs')
export class UserActivityController {
  constructor(private readonly userActivityService: UserActivityService) {}

  @RequirePermissions(Permission.VIEW_USERS)
  @ApiOperation({ summary: 'Get' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get()
  async queryActivities(@Query() query: ActivityQueryDto) {
    return this.userActivityService.queryActivities(query);
  }

  @RequirePermissions(Permission.VIEW_USERS)
  @ApiOperation({ summary: 'Get export' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('export')
  async exportActivities(@Query() query: ActivityQueryDto) {
    const csv = await this.userActivityService.exportActivities(query);
    return {
      fileName: `activity-export-${Date.now()}.csv`,
      mimeType: 'text/csv',
      data: csv,
    };
  }
}
