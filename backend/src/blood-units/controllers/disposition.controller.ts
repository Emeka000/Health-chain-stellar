import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { DispositionService } from '../services/disposition.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  UnitDisposition,
  DispositionReason,
} from '../enums/unit-disposition.enum';

class EvaluateDispositionDto {
  bloodUnitId: string;
  elapsedTimeMinutes: number;
  temperatureBreach: boolean;
  coldChainVerified: boolean;
}

class RecordDispositionDto {
  bloodUnitId: string;
  disposition: UnitDisposition;
  reason: DispositionReason;
  notes?: string;
  elapsedTimeMinutes?: number;
  temperatureBreach?: boolean;
  coldChainVerified?: boolean;
}

@ApiTags('Blood Units')
@ApiBearerAuth()
@Controller('api/v1/dispositions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DispositionController {
  constructor(private readonly dispositionService: DispositionService) {}

  @ApiOperation({ summary: 'Post evaluate' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('evaluate')
  @Roles(UserRole.OPERATIONS_STAFF, UserRole.BLOOD_BANK_ADMIN)
  async evaluateFailedDelivery(@Body() dto: EvaluateDispositionDto) {
    return this.dispositionService.evaluateFailedDelivery(
      dto.bloodUnitId,
      dto.elapsedTimeMinutes,
      dto.temperatureBreach,
      dto.coldChainVerified,
    );
  }

  @ApiOperation({ summary: 'Post record' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('record')
  @Roles(UserRole.OPERATIONS_STAFF, UserRole.BLOOD_BANK_ADMIN)
  async recordDisposition(
    @Body() dto: RecordDispositionDto,
    @CurrentUser() user: any,
  ) {
    return this.dispositionService.recordDisposition(
      dto.bloodUnitId,
      dto.disposition,
      dto.reason,
      user.id,
      dto.notes,
      dto.elapsedTimeMinutes,
      dto.temperatureBreach,
      dto.coldChainVerified,
    );
  }

  @ApiOperation({ summary: 'Get history :bloodUnitId' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('history/:bloodUnitId')
  @Roles(
    UserRole.OPERATIONS_STAFF,
    UserRole.BLOOD_BANK_ADMIN,
    UserRole.HOSPITAL_ADMIN,
  )
  async getDispositionHistory(@Param('bloodUnitId') bloodUnitId: string) {
    return this.dispositionService.getDispositionHistory(bloodUnitId);
  }
}
