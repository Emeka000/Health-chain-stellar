import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { DlqEntryStatus } from '../entities/notification-dlq.entity';
import { NotificationDlqService } from '../services/notification-dlq.service';

@Controller('notifications/dlq')
export class NotificationDlqController {
  constructor(private readonly dlqService: NotificationDlqService) {}

  @RequirePermissions(Permission.MANAGE_NOTIFICATIONS)
  @Get()
  list(
    @Query('status') status?: DlqEntryStatus,
    @Query('limit') limit?: number,
  ) {
    return this.dlqService.list(status, limit ? Number(limit) : 50);
  }

  @RequirePermissions(Permission.MANAGE_NOTIFICATIONS)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.dlqService.get(id);
  }

  @RequirePermissions(Permission.MANAGE_NOTIFICATIONS)
  @Post(':id/replay')
  replay(@Param('id') id: string, @Req() req: { user?: { id?: string } }) {
    return this.dlqService.replay(id, req.user?.id ?? 'system');
  }

  @RequirePermissions(Permission.MANAGE_NOTIFICATIONS)
  @Post('replay/bulk')
  replayBulk(
    @Body() body: { channel?: string },
    @Req() req: { user?: { id?: string } },
  ) {
    return this.dlqService.replayBulk(req.user?.id ?? 'system', body.channel);
  }

  @RequirePermissions(Permission.MANAGE_NOTIFICATIONS)
  @Post(':id/abandon')
  abandon(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: { user?: { id?: string } },
  ) {
    return this.dlqService.abandon(id, body.reason, req.user?.id ?? 'system');
  }
}
