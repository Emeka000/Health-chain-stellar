import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { DlqEntryStatus } from '../entities/notification-dlq.entity';
import { NotificationDlqService } from '../services/notification-dlq.service';

export class ReplayBulkDto {
  @ApiPropertyOptional({ description: 'Optional channel filter' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  channel?: string;
}

export class AbandonDlqEntryDto {
  @ApiPropertyOptional({ description: 'Reason for abandoning the entry' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications/dlq')
export class NotificationDlqController {
  constructor(private readonly dlqService: NotificationDlqService) {}

  @RequirePermissions(Permission.MANAGE_NOTIFICATIONS)
  @ApiOperation({ summary: 'Get' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get()
  list(
    @Query('status') status?: DlqEntryStatus,
    @Query('limit') limit?: number,
  ) {
    return this.dlqService.list(status, limit ? Number(limit) : 50);
  }

  @RequirePermissions(Permission.MANAGE_NOTIFICATIONS)
  @ApiOperation({ summary: 'Get :id' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id')
  get(@Param('id') id: string) {
    return this.dlqService.get(id);
  }

  @RequirePermissions(Permission.MANAGE_NOTIFICATIONS)
  @ApiOperation({ summary: 'Post :id replay' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/replay')
  replay(@Param('id') id: string, @Req() req: { user?: { id?: string } }) {
    return this.dlqService.replay(id, req.user?.id ?? 'system');
  }

  @RequirePermissions(Permission.MANAGE_NOTIFICATIONS)
  @ApiOperation({ summary: 'Post replay bulk' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('replay/bulk')
  replayBulk(
    @Body() body: ReplayBulkDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.dlqService.replayBulk(req.user?.id ?? 'system', body.channel);
  }

  @RequirePermissions(Permission.MANAGE_NOTIFICATIONS)
  @ApiOperation({ summary: 'Post :id abandon' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/abandon')
  abandon(
    @Param('id') id: string,
    @Body() body: AbandonDlqEntryDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.dlqService.abandon(id, body.reason, req.user?.id ?? 'system');
  }
}
