import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import {
  BloodMatchingService,
  MatchingRequest,
  MatchingResponse,
} from '../services/blood-matching.service';
import { BloodCompatibilityEngine } from '../compatibility/blood-compatibility.engine';
import type { PreviewRequest } from '../compatibility/compatibility.types';

@Controller('blood-matching')
export class BloodMatchingController {
  constructor(
    private readonly matchingService: BloodMatchingService,
    private readonly compatibilityEngine: BloodCompatibilityEngine,
  ) {}

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Post('match')
  @HttpCode(HttpStatus.OK)
  findMatches(@Body() request: MatchingRequest): Promise<MatchingResponse> {
    return this.matchingService.findMatches(request);
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Post('match-multiple')
  @HttpCode(HttpStatus.OK)
  findMatchesForMultipleRequests(
    @Body() requests: MatchingRequest[],
  ): Promise<MatchingResponse[]> {
    return this.matchingService.findMatchesForMultipleRequests(requests);
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('compatibility')
  getCompatibilityMatrix() {
    return this.matchingService.getCompatibilityMatrix();
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('compatible-types')
  getCompatibleBloodTypes(@Query('bloodType') bloodType: string) {
    return {
      compatibleTypes: this.matchingService.getCompatibleBloodTypes(bloodType),
    };
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('donatable-types')
  getDonatableBloodTypes(@Query('bloodType') bloodType: string) {
    return {
      donatableTypes: this.matchingService.getDonatableBloodTypes(bloodType),
    };
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('calculate-score')
  calculateMatchingScore(
    @Query('bloodType') bloodType: string,
    @Query('urgency') urgency: 'low' | 'medium' | 'high' | 'critical',
    @Query('daysUntilExpiration') daysUntilExpiration: number,
    @Query('distance') distance?: number,
  ) {
    return this.matchingService.calculateMatchingScore(
      bloodType,
      urgency,
      daysUntilExpiration,
      distance ? Number(distance) : undefined,
    );
  }

  /** Admin preview: check compatibility with explanation for a given donor/recipient/component */
  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() req: PreviewRequest) {
    return this.compatibilityEngine.preview(req);
  }

  /** Return all compatible donors for a recipient + component */
  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('compatible-donors')
  compatibleDonors(
    @Query('recipientType') recipientType: string,
    @Query('component') component: string,
    @Query('allowEmergency') allowEmergency?: string,
  ) {
    return this.compatibilityEngine.compatibleDonors(
      recipientType as any,
      component as any,
      allowEmergency === 'true',
    );
  }
}
