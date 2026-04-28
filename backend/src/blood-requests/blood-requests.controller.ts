import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { BloodComponent } from '../blood-units/enums/blood-component.enum';
import { RoleAwareThrottlerGuard } from '../throttler/role-aware-throttler.guard';

import { BloodRequestsService } from './blood-requests.service';
import { CreateBloodRequestDto } from './dto/create-blood-request.dto';
import { GetAvailabilityRequestDto, GetAvailabilityResponseDto } from './dto/get-availability.dto';
import { BloodBankAvailabilityService } from './services/blood-bank-availability.service';

@UseGuards(RoleAwareThrottlerGuard)
@Controller('blood-requests')
export class BloodRequestsController {
  constructor(
    private readonly bloodRequestsService: BloodRequestsService,
    private readonly availabilityService: BloodBankAvailabilityService,
  ) {}

  @RequirePermissions(Permission.CREATE_ORDER)
  @Post()
  create(
    @Body() dto: CreateBloodRequestDto,
    @Req() req: { user: { id: string; role: string; email: string } },
  ) {
    return this.bloodRequestsService.create(dto, req.user);
  }

  /**
   * GET /blood-requests/availability
   * Find nearby blood banks with requested blood type/component
   * Returns ranked list by confidence score (stock, ETA, reliability)
   */
  @Get('availability')
  async getAvailability(
    @Query() query: GetAvailabilityRequestDto,
  ): Promise<GetAvailabilityResponseDto> {
    return this.availabilityService.findNearbyBanksWithStock(
      query.bloodType,
      query.component || BloodComponent.WHOLE_BLOOD,
      query.latitude,
      query.longitude,
      query.deliveryAddress,
      query.maxDistanceKm || 100,
      query.maxResultsCount || 10,
    );
  }
}