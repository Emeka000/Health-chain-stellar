import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import {
  AlertType,
  AlertStatus,
  AlertSeverity,
} from '../entities/inventory-alert.entity';
import {
  InventoryAlertService,
  DismissAlertParams,
  ResolveAlertParams,
} from '../services/inventory-alert.service';

@Controller('inventory/alerts')
export class InventoryAlertController {
  constructor(private readonly alertService: InventoryAlertService) {}

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get()
  getAlerts(
    @Query('bloodBankId') bloodBankId?: string,
    @Query('alertType') alertType?: AlertType,
    @Query('status') status?: AlertStatus,
    @Query('severity') severity?: AlertSeverity,
    @Query('limit') limit: number = 50,
    @Query('offset') offset: number = 0,
  ) {
    return this.alertService.getAlerts(
      {
        bloodBankId,
        alertType,
        status,
        severity,
      },
      Number(limit),
      Number(offset),
    );
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('stats')
  getAlertStats(@Query('bloodBankId') bloodBankId?: string) {
    return this.alertService.getAlertStats(bloodBankId);
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get(':id')
  getAlertById(@Param('id') id: string) {
    return this.alertService.getAlertById(id);
  }

  @RequirePermissions(Permission.MANAGE_INVENTORY)
  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  dismissAlert(@Param('id') id: string, @Request() req: any) {
    const params: DismissAlertParams = {
      alertId: id,
      dismissedBy: req.user?.id,
    };
    return this.alertService.dismissAlert(params);
  }

  @RequirePermissions(Permission.MANAGE_INVENTORY)
  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  resolveAlert(@Param('id') id: string, @Request() req: any) {
    const params: ResolveAlertParams = {
      alertId: id,
      resolvedBy: req.user?.id,
    };
    return this.alertService.resolveAlert(params);
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('preferences/:organizationId')
  getAlertPreferences(@Param('organizationId') organizationId: string) {
    return this.alertService.getAlertPreferences(organizationId);
  }

  @RequirePermissions(Permission.MANAGE_INVENTORY)
  @Post('preferences/:organizationId')
  @HttpCode(HttpStatus.OK)
  updateAlertPreferences(
    @Param('organizationId') organizationId: string,
    @Body() updates: any,
  ) {
    return this.alertService.updateAlertPreferences(organizationId, updates);
  }
}
