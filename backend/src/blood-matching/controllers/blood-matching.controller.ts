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
import {
  ApiCompatibility,
  ApiCompatibilityClass,
  ApiDeprecation,
  ApiLegacyAdapter,
} from '../../common/versioning/api-compatibility.decorator';

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
  @ApiCompatibility(ApiCompatibilityClass.DEPRECATED)
  @ApiDeprecation({
    deprecation: true,
    sunset: 'Wed, 31 Dec 2026 23:59:59 GMT',
    successorPath: '/api/v1/blood-matching/compatible-donors',
  })
  getCompatibleBloodTypes(@Query('bloodType') bloodType: string) {
    return {
      compatibleTypes: this.matchingService.getCompatibleBloodTypes(bloodType),
    };
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('donatable-types')
  @ApiCompatibility(ApiCompatibilityClass.DEPRECATED)
  @ApiDeprecation({
    deprecation: true,
    sunset: 'Wed, 31 Dec 2026 23:59:59 GMT',
    successorPath: '/api/v1/blood-matching/compatible-donors',
  })
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
  @ApiCompatibility(ApiCompatibilityClass.STRICT)
  preview(@Body() req: PreviewRequest) {
    return this.compatibilityEngine.preview(req);
  }

  /** Return all compatible donors for a recipient + component */
  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('compatible-donors')
  @ApiCompatibility(ApiCompatibilityClass.ADDITIVE)
  @ApiDeprecation({
    deprecation: true,
    sunset: 'Wed, 31 Dec 2026 23:59:59 GMT',
    successorPath: '/api/v2/blood-matching/compatible-donors',
  })
  @ApiLegacyAdapter((payload) => {
    const typed = payload as { donors?: Array<{ donorType: string }> };
    return (typed.donors ?? []).map((d) => d.donorType);
  })
  compatibleDonors(
    @Query('recipientType') recipientType: string,
    @Query('component') component: string,
    @Query('allowEmergency') allowEmergency?: string,
  ) {
    const donors = this.compatibilityEngine.compatibleDonors(
      recipientType as any,
      component as any,
      allowEmergency === 'true',
    );
    return {
      recipientType,
      component,
      allowEmergencySubstitution: allowEmergency === 'true',
      donors,
    };
  }
}
