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
import { RidersService } from './riders.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

@Controller('riders')
export class RidersController {
  constructor(private readonly ridersService: RidersService) {}

  @RequirePermissions(Permission.VIEW_RIDERS)
  @Get()
  findAll(@Query('status') status?: string) {
    return this.ridersService.findAll(status);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @Get('available')
  getAvailable() {
    return this.ridersService.getAvailableRiders();
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @Get('nearby')
  getNearby(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('radius') radius: string = '10',
  ) {
    return this.ridersService.getNearbyRiders(
      parseFloat(latitude),
      parseFloat(longitude),
      parseFloat(radius),
    );
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ridersService.findOne(id);
  }

  @RequirePermissions(Permission.CREATE_RIDER)
  @Post()
  create(@Body() createRiderDto: any) {
    return this.ridersService.create(createRiderDto);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateRiderDto: any) {
    return this.ridersService.update(id, updateRiderDto);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.ridersService.updateStatus(id, status);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @Patch(':id/location')
  updateLocation(
    @Param('id') id: string,
    @Body('latitude') latitude: number,
    @Body('longitude') longitude: number,
  ) {
    return this.ridersService.updateLocation(id, latitude, longitude);
  }

  @RequirePermissions(Permission.DELETE_RIDER)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.ridersService.remove(id);
  }
}
