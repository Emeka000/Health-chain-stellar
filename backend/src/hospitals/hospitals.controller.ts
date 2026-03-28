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
  Request,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpsertCapacityConfigDto } from './dto/hospital-capacity-config.dto';
import {
  IntakeWindowCheckDto,
  RequestEmergencyOverrideDto,
} from './dto/intake-window-check.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { OverrideReason } from './enums/override-reason.enum';
import { HospitalIntakeWindowService } from './services/hospital-intake-window.service';
import { HospitalsService } from './hospitals.service';

@Controller('hospitals')
export class HospitalsController {
  constructor(
    private readonly hospitalsService: HospitalsService,
    private readonly intakeWindowService: HospitalIntakeWindowService,
  ) {}

  // ── Core CRUD ─────────────────────────────────────────────────────────────

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
  create(@Body() dto: CreateHospitalDto) {
    return this.hospitalsService.create(dto);
  }

  @RequirePermissions(Permission.UPDATE_HOSPITAL)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateHospitalDto) {
    return this.hospitalsService.update(id, dto);
  }

  @RequirePermissions(Permission.DELETE_HOSPITAL)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.hospitalsService.remove(id);
  }

  // ── Capacity config ───────────────────────────────────────────────────────

  @RequirePermissions(Permission.UPDATE_HOSPITAL)
  @Post(':id/capacity-config')
  upsertCapacityConfig(
    @Param('id') id: string,
    @Body() dto: UpsertCapacityConfigDto,
  ) {
    return this.hospitalsService.upsertCapacityConfig(id, dto);
  }

  @RequirePermissions(Permission.VIEW_HOSPITALS)
  @Get(':id/capacity-config')
  getCapacityConfig(@Param('id') id: string) {
    return this.hospitalsService.getCapacityConfig(id);
  }

  // ── Intake window checks ──────────────────────────────────────────────────

  @RequirePermissions(Permission.VIEW_HOSPITALS)
  @Post('intake-check')
  checkIntakeWindow(@Body() dto: IntakeWindowCheckDto) {
    return this.intakeWindowService.checkIntakeWindow(
      dto.hospitalId,
      new Date(dto.projectedDeliveryAt),
      dto.unitsRequested,
    );
  }

  // ── Emergency overrides ───────────────────────────────────────────────────

  @RequirePermissions(Permission.MANAGE_HOSPITAL_OVERRIDES)
  @Post('override')
  async requestOverride(
    @Body() dto: RequestEmergencyOverrideDto,
    @Request() req: any,
  ) {
    // First run the check to capture what constraint is being bypassed
    const checkResult = await this.intakeWindowService.checkIntakeWindow(
      dto.hospitalId,
      dto.projectedDeliveryAt ? new Date(dto.projectedDeliveryAt) : new Date(),
    );

    const audit = await this.intakeWindowService.recordOverride({
      hospitalId: dto.hospitalId,
      approvedByUserId: req.user.sub,
      reason: dto.reason,
      reasonNotes: dto.reasonNotes,
      orderId: dto.orderId,
      bloodRequestId: dto.bloodRequestId,
      projectedDeliveryAt: dto.projectedDeliveryAt
        ? new Date(dto.projectedDeliveryAt)
        : undefined,
      bypassedConstraint: {
        violations: checkResult.constraintViolations,
        checkResult,
      },
      isEmergency:
        dto.reason === OverrideReason.MASS_CASUALTY_EVENT ||
        dto.reason === OverrideReason.CRITICAL_PATIENT,
    });

    return {
      message: 'Emergency override recorded',
      data: audit,
    };
  }

  @RequirePermissions(Permission.VIEW_HOSPITAL_OVERRIDES)
  @Get(':id/overrides')
  getOverrideAuditLog(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.intakeWindowService.getOverrideAuditLog(
      id,
      limit ? parseInt(limit, 10) : 50,
    );
  }
}
