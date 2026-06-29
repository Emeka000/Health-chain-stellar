import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Param,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { NotificationPreferenceService } from '../services/notification-preference.service';
import {
  NotificationChannel,
  NotificationCategory,
  EmergencyTier,
} from '../entities/notification-preference.entity';
import { SecurityEventLoggerService, SecurityEventType } from '../../user-activity/security-event-logger.service';

class SetPreferenceDto {
  category: NotificationCategory;
  channels: NotificationChannel[];
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  emergencyBypassTier?: EmergencyTier;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('api/v1/notification-preferences')
@UseGuards(JwtAuthGuard)
export class NotificationPreferenceController {
  constructor(
    private readonly preferenceService: NotificationPreferenceService,
    private readonly securityEventLogger: SecurityEventLoggerService,
  ) {}

  @ApiOperation({ summary: 'Get' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get()
  async getMyPreferences(@CurrentUser() user: any) {
    return this.preferenceService.getUserPreferences(user.id);
  }

  @ApiOperation({ summary: 'Post' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post()
  async setPreference(
    @Body() dto: SetPreferenceDto,
    @CurrentUser() user: any,
  ) {
    return this.preferenceService.setPreference(
      user.id,
      dto.category,
      dto.channels,
      dto.quietHoursEnabled,
      dto.quietHoursStart,
      dto.quietHoursEnd,
      dto.emergencyBypassTier,
    );
  }

  @ApiOperation({ summary: 'Get delivery logs' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('delivery-logs')
  async getMyDeliveryLogs(@CurrentUser() user: any) {
    return this.preferenceService.getDeliveryLogs(user.id);
  }

  @ApiOperation({ summary: 'Get delivery logs :userId' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('delivery-logs/:userId')
  async getUserDeliveryLogs(@Param('userId') userId: string, @CurrentUser() user: any) {
    const role = String(user?.role ?? '').toLowerCase();
    if (role !== 'admin' && userId !== user?.id) {
      await this.securityEventLogger
        .logEvent({
          eventType: SecurityEventType.TENANT_ACCESS_DENIED,
          userId: user?.id ?? null,
          description: 'Cross-tenant notification delivery log access denied',
          metadata: { targetUserId: userId },
        })
        .catch(() => undefined);
      throw new ForbiddenException('Cannot access another user delivery logs');
    }
    return this.preferenceService.getDeliveryLogs(userId);
  }
}
