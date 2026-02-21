import {
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
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { OrderQueryParamsDto } from './dto/order-query-params.dto';
import { OrdersResponseDto } from './dto/orders-response.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermissions(Permission.READ_ORDER)
  async findAllWithFilters(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
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
  ): Promise<OrdersResponseDto> {
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

  @Get(':id')
  @RequirePermissions(Permission.READ_ORDER)
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  /**
   * GET /orders/:id/history
   * Returns the full, chronologically-ordered event log for an order.
   * Each row contains: order_id, event_type, payload, actor_id, timestamp.
   */
  @Get(':id/history')
  @RequirePermissions(Permission.READ_ORDER)
  getOrderHistory(@Param('id') id: string) {
    return this.ordersService.getOrderHistory(id);
  }

  @Get(':id/track')
  @RequirePermissions(Permission.READ_ORDER)
  trackOrder(@Param('id') id: string) {
    return this.ordersService.trackOrder(id);
  }

  @Post()
  @RequirePermissions(Permission.CREATE_ORDER)
  create(@Body() createOrderDto: any, @Request() req: any) {
    const actorId: string | undefined = req.user?.id;
    return this.ordersService.create(createOrderDto, actorId);
  }

  @Patch(':id')
  @RequirePermissions(Permission.UPDATE_ORDER)
  update(@Param('id') id: string, @Body() updateOrderDto: any) {
    return this.ordersService.update(id, updateOrderDto);
  }

  @Patch(':id/status')
  @RequirePermissions(Permission.UPDATE_ORDER)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Request() req: any,
  ) {
    const actorId: string | undefined = req.user?.id;
    return this.ordersService.updateStatus(id, status, actorId);
  }

  @Patch(':id/assign-rider')
  @RequirePermissions(Permission.MANAGE_RIDERS)
  assignRider(
    @Param('id') id: string,
    @Body('riderId') riderId: string,
    @Request() req: any,
  ) {
    const actorId: string | undefined = req.user?.id;
    return this.ordersService.assignRider(id, riderId, actorId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.CANCEL_ORDER)
  remove(@Param('id') id: string, @Request() req: any) {
    const actorId: string | undefined = req.user?.id;
    return this.ordersService.remove(id, actorId);
  }
}
