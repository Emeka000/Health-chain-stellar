import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { User } from '../auth/decorators/user.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { PaginatedResponse, PaginationQueryDto } from '../common/pagination';

import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { CreateRiderDto } from './dto/create-rider.dto';
import { RegisterRiderDto } from './dto/register-rider.dto';
import { UpdateRiderDto } from './dto/update-rider.dto';
import { UpdateRiderLocationDto } from './dto/update-rider-location.dto';
import { UpdateRiderStatusDto } from './dto/update-rider-status.dto';
import { WorkingHoursDto } from './dto/working-hours.dto';
import { RiderEntity } from './entities/rider.entity';
import { RiderStatus } from './enums/rider-status.enum';
import { RidersService } from './riders.service';

@ApiTags('Riders')
@ApiBearerAuth()
@Controller('riders')
export class RidersController {
  constructor(private readonly ridersService: RidersService) {}

  @RequirePermissions(Permission.VIEW_RIDERS)
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
    @Query('status') status?: RiderStatus,
  ): Promise<PaginatedResponse<RiderEntity>> {
    return this.ridersService.findAll(status, paginationDto);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get available' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('available')
  getAvailable() {
    return this.ridersService.getAvailableRiders();
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get availability' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('availability')
  queryAvailability(
    @Query(
      new ValidationPipe({ transform: true, whitelist: true }),
    )
    query: AvailabilityQueryDto,
  ) {
    return this.ridersService.queryAvailability(query);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get leaderboard' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('leaderboard')
  getLeaderboard(@Query('limit') limit?: string) {
    return this.ridersService.getLeaderboard(limit ? parseInt(limit, 10) : 10);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get nearby' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
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
  @ApiOperation({ summary: 'Get me' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('me')
  getMe(@User('id') userId: string) {
    return this.ridersService.findByUserId(userId);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get :id' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ridersService.findOne(id);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get :id performance' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id/performance')
  getPerformance(@Param('id') id: string) {
    return this.ridersService.getPerformance(id);
  }

  @ApiOperation({ summary: 'Post register' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('register')
  register(
    @User('id') userId: string,
    @Body() registerRiderDto: RegisterRiderDto,
  ) {
    return this.ridersService.register(userId, registerRiderDto);
  }

  @RequirePermissions(Permission.CREATE_RIDER)
  @ApiOperation({ summary: 'Post' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post()
  create(@Body() createRiderDto: CreateRiderDto) {
    return this.ridersService.create(createRiderDto);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @ApiOperation({ summary: 'Patch :id' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateRiderDto: UpdateRiderDto) {
    return this.ridersService.update(id, updateRiderDto);
  }

  @RequirePermissions(Permission.MANAGE_RIDERS)
  @ApiOperation({ summary: 'Patch :id verify' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/verify')
  verify(@Param('id') id: string) {
    return this.ridersService.verify(id);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @ApiOperation({ summary: 'Patch :id status' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateRiderStatusDto,
  ) {
    return this.ridersService.updateStatus(id, dto);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @ApiOperation({ summary: 'Patch :id location' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/location')
  updateLocation(
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateRiderLocationDto,
  ) {
    return this.ridersService.updateLocation(id, dto);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @ApiOperation({ summary: 'Patch :id working hours' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/working-hours')
  setWorkingHours(
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: WorkingHoursDto,
  ) {
    return this.ridersService.setWorkingHours(id, dto);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @ApiOperation({ summary: 'Patch :id preferred areas' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/preferred-areas')
  setPreferredAreas(
    @Param('id') id: string,
    @Body('areas') areas: string[],
  ) {
    return this.ridersService.setPreferredAreas(id, areas);
  }

  @RequirePermissions(Permission.DELETE_RIDER)
  @ApiOperation({ summary: 'Delete :id' })
  @ApiResponse({ status: 200, description: 'Resource deleted successfully' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.ridersService.remove(id);
  }
}
