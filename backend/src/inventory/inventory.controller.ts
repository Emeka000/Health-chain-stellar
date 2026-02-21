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
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get()
  findAll(@Query('hospitalId') hospitalId?: string) {
    return this.inventoryService.findAll(hospitalId);
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('low-stock')
  getLowStock(@Query('threshold') threshold: string = '10') {
    return this.inventoryService.getLowStockItems(parseInt(threshold, 10));
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.inventoryService.findOne(id);
  }

  @RequirePermissions(Permission.CREATE_INVENTORY)
  @Post()
  create(@Body() createInventoryDto: any) {
    return this.inventoryService.create(createInventoryDto);
  }

  @RequirePermissions(Permission.UPDATE_INVENTORY)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateInventoryDto: any) {
    return this.inventoryService.update(id, updateInventoryDto);
  }

  @RequirePermissions(Permission.UPDATE_INVENTORY)
  @Patch(':id/stock')
  updateStock(@Param('id') id: string, @Body('quantity') quantity: number) {
    return this.inventoryService.updateStock(id, quantity);
  }

  @RequirePermissions(Permission.DELETE_INVENTORY)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.inventoryService.remove(id);
  }
}
