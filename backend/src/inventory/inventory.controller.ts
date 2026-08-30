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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { PaginatedResponse, PaginationQueryDto } from '../common/pagination';

import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { InventoryStockEntity } from './entities/inventory-stock.entity';
import { InventoryForecastingService } from './inventory-forecasting.service';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly inventoryForecastingService: InventoryForecastingService,
  ) {}

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get()
  findAll(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    paginationDto: PaginationQueryDto,
    @Query('hospitalId') hospitalId?: string,
  ): Promise<PaginatedResponse<InventoryStockEntity>> {
    return this.inventoryService.findAll(hospitalId, paginationDto);
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get low stock' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('low-stock')
  getLowStock(@Query('threshold') threshold: string = '10') {
    return this.inventoryService.getLowStockItems(parseInt(threshold, 10));
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get critical stock' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('critical-stock')
  getCriticalStock() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.inventoryService.getCriticalStockItems();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get aggregation' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('aggregation')
  getStockAggregation() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.inventoryService.getStockAggregation();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get stats' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('stats')
  getInventoryStats(@Query('hospitalId') hospitalId?: string) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.inventoryService.getInventoryStats(hospitalId);
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get reorder summary' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('reorder-summary')
  getReorderSummary() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.inventoryService.getReorderSummary();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get forecast' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('forecast')
  getForecast() {
    return this.inventoryForecastingService.calculateDemandForecasts();
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Post forecast recalibrate' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('forecast/recalibrate')
  recalibrateForecast() {
    return this.inventoryForecastingService.recalibrate();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get :id' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.inventoryService.findOne(id);
  }

  @RequirePermissions(Permission.INVENTORY_WRITE)
  @ApiOperation({ summary: 'Post' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post()
  create(@Body() createInventoryDto: CreateInventoryDto) {
    return this.inventoryService.create(createInventoryDto);
  }

  @RequirePermissions(Permission.INVENTORY_WRITE)
  @ApiOperation({ summary: 'Patch :id' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateInventoryDto: UpdateInventoryDto,
  ) {
    return this.inventoryService.update(id, updateInventoryDto);
  }

  @RequirePermissions(Permission.INVENTORY_WRITE)
  @ApiOperation({ summary: 'Patch :id stock' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/stock')
  updateStock(@Param('id') id: string, @Body('quantity') quantity: number) {
    return this.inventoryService.updateStock(id, quantity);
  }

  @RequirePermissions(Permission.INVENTORY_WRITE)
  @ApiOperation({ summary: 'Patch :id reserve' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/reserve')
  reserveStock(@Param('id') id: string, @Body('quantity') quantity: number) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.inventoryService.reserveStock(id, quantity);
  }

  @RequirePermissions(Permission.INVENTORY_WRITE)
  @ApiOperation({ summary: 'Patch :id release' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/release')
  releaseStock(@Param('id') id: string, @Body('quantity') quantity: number) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.inventoryService.releaseStock(id, quantity);
  }

  @RequirePermissions(Permission.INVENTORY_WRITE)
  @ApiOperation({ summary: 'Delete :id' })
  @ApiResponse({ status: 200, description: 'Resource deleted successfully' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.inventoryService.remove(id);
  }
}
