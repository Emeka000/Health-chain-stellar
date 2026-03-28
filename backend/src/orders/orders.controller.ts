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
  ValidationPipe,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { PaginatedResponse } from '../common/pagination';

import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryParamsDto } from './dto/order-query-params.dto';
import { UpdateRequestStatusDto } from './dto/update-request-status.dto';
import { OrdersService } from './orders.service';
import { Order } from './types/order.types';

interface AuthenticatedRequest {
  user?: {
    id: string;
    role?: string;
  };
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @RequirePermissions(Permission.VIEW_ORDER)
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

    return this.ordersService.findAllWithFilters(params);
  }

  @RequirePermissions(Permission.VIEW_ORDER)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  /**
   * GET /orders/:id/history
   * Returns the full, chronologically-ordered event log for an order.
   * Each row contains: order_id, event_type, payload, actor_id, timestamp.
   */
  @RequirePermissions(Permission.VIEW_ORDER)
  @Get(':id/history')
  getOrderHistory(@Param('id') id: string) {
    return this.ordersService.getOrderHistory(id);
  }

  @RequirePermissions(Permission.VIEW_ORDER)
  @Get(':id/track')
  trackOrder(@Param('id') id: string) {
    return this.ordersService.trackOrder(id);
  }

  @RequirePermissions(Permission.VIEW_ORDER)
  @Post(':id/preview-fees')
  previewOrderFees(@Param('id') id: string, @Body() previewData: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.ordersService.previewOrderFees(id, previewData);
  }

  @RequirePermissions(Permission.CREATE_ORDER)
  @Post()
  create(
    @Body() createOrderDto: CreateOrderDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const actorId: string | undefined = req.user?.id;

    return this.ordersService.create(createOrderDto, actorId);
  }

  @RequirePermissions(Permission.UPDATE_ORDER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateOrderDto: any) {
    return this.ordersService.update(id, updateOrderDto);
  }

  @RequirePermissions(Permission.UPDATE_ORDER)
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
    );
  }

  @RequirePermissions(Permission.MANAGE_RIDERS)
  @Patch(':id/assign-rider')
  assignRider(
    @Param('id') id: string,
    @Body('riderId') riderId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const actorId: string | undefined = req.user?.id;
    return this.ordersService.assignRider(id, riderId, actorId);
  }

  @RequirePermissions(Permission.DELETE_ORDER)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const actorId: string | undefined = req.user?.id;
    return this.ordersService.remove(id, actorId);
  }

  @RequirePermissions(Permission.UPDATE_ORDER)
  @Patch(':id/raise-dispute')
  @HttpCode(HttpStatus.OK)
  raiseDispute(
    @Param('id') id: string,

    @Body() dto: any,
    @Request() req: AuthenticatedRequest,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.ordersService.raiseDispute(id, dto, req.user?.id);
  }

  @RequirePermissions(Permission.UPDATE_ORDER)
  @Patch(':id/resolve-dispute')
  @HttpCode(HttpStatus.OK)
  resolveDispute(
    @Param('id') id: string,

    @Body() dto: any,
    @Request() req: AuthenticatedRequest,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.ordersService.resolveDispute(id, dto, req.user?.id);
  }
}
