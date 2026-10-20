import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

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
import { RiderSearchService } from './services/rider-search.service';

@ApiTags('Riders')
@ApiBearerAuth()
@Controller('riders')
export class RidersController {
  constructor(
    private readonly ridersService: RidersService,
    private readonly riderSearchService: RiderSearchService,
  ) {}

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'List riders' })
  @ApiResponse({ status: 200, description: 'Paginated list of riders' })
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
  @ApiOperation({ summary: 'List available riders' })
  @ApiResponse({ status: 200, description: 'List of currently available riders' })
  @Get('available')
  getAvailable() {
    return this.ridersService.getAvailableRiders();
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Query rider availability' })
  @ApiResponse({ status: 200, description: 'Riders matching the availability query' })
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
  @ApiOperation({ summary: 'Get rider leaderboard' })
  @ApiResponse({ status: 200, description: 'Top riders ranked by performance' })
  @Get('leaderboard')
  getLeaderboard(@Query('limit') limit?: string) {
    return this.ridersService.getLeaderboard(limit ? parseInt(limit, 10) : 10);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get nearby riders' })
  @ApiResponse({ status: 200, description: 'Riders within the given radius' })
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
  @ApiOperation({ summary: 'Get current rider profile' })
  @ApiResponse({ status: 200, description: 'Rider profile for the authenticated user' })
  @Get('me')
  getMe(@User('id') userId: string) {
    return this.ridersService.findByUserId(userId);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Search riders' })
  @ApiResponse({ status: 200, description: 'Paginated search results' })
  @Get('search')
  search(
    @Query(
      new ValidationPipe({ transform: true, whitelist: true }),
    )
    query: PaginationQueryDto,
  ) {
    return this.riderSearchService.searchRiders(query);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get rider statistics' })
  @ApiResponse({ status: 200, description: 'Aggregated rider statistics' })
  @Get('statistics')
  getStatistics() {
    return this.ridersService.getStatistics();
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get rider by ID' })
  @ApiResponse({ status: 200, description: 'Rider details' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ridersService.findOne(id);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get rider performance' })
  @ApiResponse({ status: 200, description: 'Performance metrics for the rider' })
  @Get(':id/performance')
  getPerformance(@Param('id') id: string) {
    return this.ridersService.getPerformance(id);
  }

  @ApiOperation({ summary: 'Register as a rider' })
  @ApiResponse({ status: 201, description: 'Rider registration created' })
  @Post('register')
  register(
    @User('id') userId: string,
    @Body() registerRiderDto: RegisterRiderDto,
  ) {
    return this.ridersService.register(userId, registerRiderDto);
  }

  @RequirePermissions(Permission.CREATE_RIDER)
  @ApiOperation({ summary: 'Create rider' })
  @ApiResponse({ status: 201, description: 'Rider created' })
  @Post()
  create(@Body() createRiderDto: CreateRiderDto) {
    return this.ridersService.create(createRiderDto);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @ApiOperation({ summary: 'Update rider' })
  @ApiResponse({ status: 200, description: 'Rider updated' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateRiderDto: UpdateRiderDto,
    @User() user: { id: string; permissions?: Permission[] },
  ) {
    await this.assertRiderAccess(id, user);
    return this.ridersService.update(id, updateRiderDto);
  }

  @RequirePermissions(Permission.MANAGE_RIDERS)
  @ApiOperation({ summary: 'Verify rider' })
  @ApiResponse({ status: 200, description: 'Rider verified' })
  @Patch(':id/verify')
  verify(@Param('id') id: string) {
    return this.ridersService.verify(id);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @ApiOperation({ summary: 'Update rider status' })
  @ApiResponse({ status: 200, description: 'Rider status updated' })
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateRiderStatusDto,
    @User() user: { id: string; permissions?: Permission[] },
  ) {
    await this.assertRiderAccess(id, user);
    return this.ridersService.updateStatus(id, dto);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @ApiOperation({ summary: 'Update rider location' })
  @ApiResponse({ status: 200, description: 'Rider location updated' })
  @Patch(':id/location')
  async updateLocation(
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateRiderLocationDto,
    @User() user: { id: string; permissions?: Permission[] },
  ) {
    await this.assertRiderAccess(id, user);
    return this.ridersService.updateLocation(id, dto);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @ApiOperation({ summary: 'Set rider working hours' })
  @ApiResponse({ status: 200, description: 'Working hours updated' })
  @Patch(':id/working-hours')
  async setWorkingHours(
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: WorkingHoursDto,
    @User() user: { id: string; permissions?: Permission[] },
  ) {
    await this.assertRiderAccess(id, user);
    return this.ridersService.setWorkingHours(id, dto);
  }

  @RequirePermissions(Permission.UPDATE_RIDER)
  @ApiOperation({ summary: 'Set rider preferred areas' })
  @ApiResponse({ status: 200, description: 'Preferred areas updated' })
  @Patch(':id/preferred-areas')
  async setPreferredAreas(
    @Param('id') id: string,
    @Body('areas') areas: string[],
    @User() user: { id: string; permissions?: Permission[] },
  ) {
    await this.assertRiderAccess(id, user);
    return this.ridersService.setPreferredAreas(id, areas);
  }

  @RequirePermissions(Permission.DELETE_RIDER)
  @ApiOperation({ summary: 'Delete rider' })
  @ApiResponse({ status: 204, description: 'Rider deleted' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @User() user: { id: string; permissions?: Permission[] },
  ) {
    await this.assertRiderAccess(id, user);
    return this.ridersService.remove(id);
  }

  private async assertRiderAccess(
    riderId: string,
    user: { id: string; permissions?: Permission[] },
  ): Promise<void> {
    const rider = await this.ridersService.findOne(id);
    const isOwner = rider.userId === user.id;
    const canManage = user.permissions?.includes(Permission.MANAGE_RIDERS);
    if (!isOwner && !canManage) {
      throw new ForbiddenException('You do not have access to this rider');
    }
  }
}
