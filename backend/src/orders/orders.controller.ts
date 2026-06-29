import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  Request,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { Auditable } from '../common/audit/auditable.decorator';
import { AuditLogInterceptor } from '../common/audit/audit-log.interceptor';
import { PaginatedResponse } from '../common/pagination';

import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryParamsDto } from './dto/order-query-params.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateRequestStatusDto } from './dto/update-request-status.dto';
import { OrdersService } from './orders.service';
import { OrderStateAuditService } from './services/order-state-audit.service';
import { Order } from './types/order.types';
import { SlaService } from '../sla/sla.service';

interface AuthenticatedRequest {
  user?: {
    id: string;
    role?: string;
    organizationId?: string | null;
  };
}

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly slaService: SlaService,
    private readonly auditService: OrderStateAuditService,
  ) {}

  /**
   * GET /orders/state-audit
   * Returns all orders with inconsistent or invalid materialized state (Issue #617).
   */
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get state audit' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('state-audit')
  auditOrderStates() {
    return this.auditService.auditAll();
  }

  @RequirePermissions(Permission.VIEW_ORDER)
  @ApiOperation({ summary: 'Get' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get()
  async findAllWithFilters(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: (errors) => {
          const messages = errors.map((error) => {
            const constraints = error.constraints;
            return constraints
              ? Object.values(constraints).join(', ')
              : 'Invalid parameter';
          });
          return new BadRequestException({
            statusCode: 400,
            message: 'Invalid query parameters',
            errors: messages,
          });
        },
      }),
    )
    params: OrderQueryParamsDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<PaginatedResponse<Order>> {
    // Additional validation for date range
    if (params.startDate && params.endDate) {
      const start = new Date(params.startDate);
      const end = new Date(params.endDate);
      if (start > end) {
        throw new BadRequestException(
          'startDate must be before or equal to endDate',
        );
      }
    }

    return this.ordersService.findAllWithFilters(params, {
      userId: req.user?.id ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @RequirePermissions(Permission.VIEW_ORDER)
  @ApiOperation({ summary: 'Get :id' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.ordersService.findOne(id, {
      userId: req.user?.id ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  /**
   * GET /orders/:id/history
   * Returns the full, chronologically-ordered event log for an order.
   * Each row contains: order_id, event_type, payload, actor_id, timestamp.
   */
  @RequirePermissions(Permission.VIEW_ORDER)
  @ApiOperation({ summary: 'Get :id sla' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id/sla')
  getOrderSla(@Param('id') id: string) {
    return this.slaService.getOrderMetrics(id);
  }

  @RequirePermissions(Permission.VIEW_ORDER)
  @ApiOperation({ summary: 'Get :id history' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id/history')
  getOrderHistory(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.ordersService.getOrderHistory(id, {
      userId: req.user?.id ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @RequirePermissions(Permission.VIEW_ORDER)
  @ApiOperation({ summary: 'Get :id track' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id/track')
  trackOrder(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.ordersService.trackOrder(id, {
      userId: req.user?.id ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @RequirePermissions(Permission.VIEW_ORDER)
  @ApiOperation({ summary: 'Post :id preview fees' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/preview-fees')
  previewOrderFees(
    @Param('id') id: string,
    @Body() previewData: any,
    @Request() req: AuthenticatedRequest,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.ordersService.previewOrderFees(id, previewData, {
      userId: req.user?.id ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @RequirePermissions(Permission.CREATE_ORDER)
  @ApiOperation({ summary: 'Post' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post()
  create(
    @Body() createOrderDto: CreateOrderDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const actorId: string | undefined = req.user?.id;

    return this.ordersService.create(createOrderDto, actorId);
  }

  @RequirePermissions(Permission.UPDATE_ORDER)
  @ApiOperation({ summary: 'Patch :id' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateOrderDto: UpdateOrderDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ordersService.update(id, updateOrderDto, {
      userId: req.user?.id ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @RequirePermissions(Permission.UPDATE_ORDER)
  @ApiOperation({ summary: 'Patch :id status' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() statusUpdateDto: UpdateRequestStatusDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const actorId: string | undefined = req.user?.id;
    const actorRole: string | undefined = req.user?.role;
    return this.ordersService.updateStatus(
      id,
      statusUpdateDto,
      actorId,
      actorRole,
      {
        userId: req.user?.id ?? 'unknown',
        role: req.user?.role,
        organizationId: req.user?.organizationId ?? null,
      },
    );
  }

  @RequirePermissions(Permission.MANAGE_RIDERS)
  @ApiOperation({ summary: 'Patch :id assign rider' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/assign-rider')
  assignRider(
    @Param('id') id: string,
    @Body('riderId') riderId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const actorId: string | undefined = req.user?.id;
    return this.ordersService.assignRider(id, riderId, actorId, {
      userId: req.user?.id ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @RequirePermissions(Permission.DELETE_ORDER)
  @ApiOperation({ summary: 'Delete :id' })
  @ApiResponse({ status: 200, description: 'Resource deleted successfully' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const actorId: string | undefined = req.user?.id;
    return this.ordersService.remove(id, actorId, {
      userId: req.user?.id ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @RequirePermissions(Permission.UPDATE_ORDER)
  @ApiOperation({ summary: 'Patch :id raise dispute' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/raise-dispute')
  @HttpCode(HttpStatus.OK)
  raiseDispute(
    @Param('id') id: string,

    @Body() dto: any,
    @Request() req: AuthenticatedRequest,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.ordersService.raiseDispute(id, dto, req.user?.id, {
      userId: req.user?.id ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }

  @RequirePermissions(Permission.UPDATE_ORDER)
  @Auditable({ action: 'order.resolve-dispute', resourceType: 'Order' })
  @UseInterceptors(AuditLogInterceptor)
  @ApiOperation({ summary: 'Patch :id resolve dispute' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/resolve-dispute')
  @HttpCode(HttpStatus.OK)
  resolveDispute(
    @Param('id') id: string,

    @Body() dto: any,
    @Request() req: AuthenticatedRequest,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.ordersService.resolveDispute(id, dto, req.user?.id, {
      userId: req.user?.id ?? 'unknown',
      role: req.user?.role,
      organizationId: req.user?.organizationId ?? null,
    });
  }
}
