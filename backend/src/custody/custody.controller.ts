import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ConfirmHandoffDto, RecordHandoffDto } from './dto/custody.dto';
import { CustodyService } from './custody.service';

@ApiTags('Custody')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('custody')
export class CustodyController {
  constructor(private readonly service: CustodyService) {}

  @Post('handoffs')
  @RequirePermissions(Permission.TRANSFER_CUSTODY)
  @ApiOperation({ summary: 'Record a custody handoff between actors' })
  record(@Body() dto: RecordHandoffDto) {
    return this.service.recordHandoff(dto);
  }

  @Post('handoffs/:id/confirm')
  @RequirePermissions(Permission.TRANSFER_CUSTODY)
  @ApiOperation({ summary: 'Confirm a pending custody handoff' })
  confirm(@Param('id') id: string, @Body() dto: ConfirmHandoffDto) {
    return this.service.confirmHandoff(id, dto);
  }

  @Get('units/:bloodUnitId/timeline')
  @RequirePermissions(Permission.VIEW_BLOODUNIT_TRAIL)
  @ApiOperation({ summary: 'Get full custody timeline for a blood unit' })
  unitTimeline(@Param('bloodUnitId') bloodUnitId: string) {
    return this.service.getTimeline(bloodUnitId);
  }

  @Get('orders/:orderId/timeline')
  @RequirePermissions(Permission.VIEW_BLOODUNIT_TRAIL)
  @ApiOperation({ summary: 'Get custody timeline for an order' })
  orderTimeline(@Param('orderId') orderId: string) {
    return this.service.getOrderTimeline(orderId);
  }
}
