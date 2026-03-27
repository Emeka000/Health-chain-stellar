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
  ValidationPipe,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { PaginatedResponse, PaginationQueryDto } from '../common/pagination';

import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { InventoryStockEntity } from './entities/inventory-stock.entity';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get()
  findAll(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    paginationDto: PaginationQueryDto,
    @Query('hospitalId') hospitalId?: string,
  ): Promise<PaginatedResponse<InventoryStockEntity>> {
    return this.inventoryService.findAll(hospitalId, paginationDto);
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('low-stock')
  getLowStock(@Query('threshold') threshold: string = '10') {
    return this.inventoryService.getLowStockItems(parseInt(threshold, 10));
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('critical-stock')
  getCriticalStock() {
    return this.inventoryService.getCriticalStockItems();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('aggregation')
  getStockAggregation() {
    return this.inventoryService.getStockAggregation();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('stats')
  getInventoryStats(@Query('hospitalId') hospitalId?: string) {
    return this.inventoryService.getInventoryStats(hospitalId);
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('reorder-summary')
  getReorderSummary() {
    return this.inventoryService.getReorderSummary();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.inventoryService.findOne(id);
  }

  @RequirePermissions(Permission.CREATE_INVENTORY)
  @Post()
  create(@Body() createInventoryDto: CreateInventoryDto) {
    return this.inventoryService.create(createInventoryDto);
  }

  @RequirePermissions(Permission.UPDATE_INVENTORY)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateInventoryDto: UpdateInventoryDto,
  ) {
    return this.inventoryService.update(id, updateInventoryDto);
  }

  @RequirePermissions(Permission.UPDATE_INVENTORY)
  @Patch(':id/stock')
  updateStock(@Param('id') id: string, @Body('quantity') quantity: number) {
    return this.inventoryService.updateStock(id, quantity);
  }

  @RequirePermissions(Permission.UPDATE_INVENTORY)
  @Patch(':id/reserve')
  reserveStock(@Param('id') id: string, @Body('quantity') quantity: number) {
    return this.inventoryService.reserveStock(id, quantity);
  }

  @RequirePermissions(Permission.UPDATE_INVENTORY)
  @Patch(':id/release')
  releaseStock(@Param('id') id: string, @Body('quantity') quantity: number) {
    return this.inventoryService.releaseStock(id, quantity);
  }

  @RequirePermissions(Permission.DELETE_INVENTORY)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.inventoryService.remove(id);
  }
}
