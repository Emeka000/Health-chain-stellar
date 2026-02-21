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
import { HospitalsService } from './hospitals.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @RequirePermissions(Permission.VIEW_HOSPITALS)
  @Get()
  findAll() {
    return this.hospitalsService.findAll();
  }

  @RequirePermissions(Permission.VIEW_HOSPITALS)
  @Get('nearby')
  getNearby(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('radius') radius: string = '10',
  ) {
    return this.hospitalsService.getNearbyHospitals(
      parseFloat(latitude),
      parseFloat(longitude),
      parseFloat(radius),
    );
  }

  @RequirePermissions(Permission.VIEW_HOSPITALS)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.hospitalsService.findOne(id);
  }

  @RequirePermissions(Permission.CREATE_HOSPITAL)
  @Post()
  create(@Body() createHospitalDto: any) {
    return this.hospitalsService.create(createHospitalDto);
  }

  @RequirePermissions(Permission.UPDATE_HOSPITAL)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateHospitalDto: any) {
    return this.hospitalsService.update(id, updateHospitalDto);
  }

  @RequirePermissions(Permission.DELETE_HOSPITAL)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.hospitalsService.remove(id);
  }
}
