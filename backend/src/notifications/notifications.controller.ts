import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Post,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @RequirePermissions(Permission.VIEW_NOTIFICATIONS)
  @Get()
  async findAll(@Query() query: NotificationQueryDto) {
    const result = await this.notificationsService.findForRecipient(query);
    return {
      message: 'Notifications retrieved successfully',
      ...result,
    };
  }

  @RequirePermissions(Permission.VIEW_NOTIFICATIONS)
  @Patch(':id/read')
  async markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }

  // Exposed for testing/admin purposes to trigger notifications manually
  @RequirePermissions(Permission.MANAGE_NOTIFICATIONS)
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async send(@Body() dto: SendNotificationDto) {
    const notifications = await this.notificationsService.send(dto);
    return {
      message: 'Notifications queued for delivery',
      data: notifications,
    };
  }
}
