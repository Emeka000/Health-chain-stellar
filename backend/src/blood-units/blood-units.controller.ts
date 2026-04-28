import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  ParseUUIDPipe,
  ParseEnumPipe,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { Request } from 'express';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { Auditable } from '../common/audit/auditable.decorator';
import { AuditLogInterceptor } from '../common/audit/audit-log.interceptor';

import { BloodInventoryQueryService } from './blood-inventory-query.service';
import { BloodStatusService } from './blood-status.service';
import { BloodUnitsService } from './blood-units.service';
import { QrVerificationService } from './qr-verification.service';
import { VerifyQrDto } from './dto/verify-qr.dto';
import {
  BulkRegisterBloodUnitsDto,
  RegisterBloodUnitDto,
  TransferCustodyDto,
  LogTemperatureDto,
} from './dto/blood-units.dto';
import { QueryBloodInventoryDto } from './dto/query-blood-inventory.dto';
import {
  BulkUpdateBloodStatusDto,
  ReserveBloodUnitDto,
  UpdateBloodStatusDto,
} from './dto/update-blood-status.dto';
import { BloodType } from './enums/blood-type.enum';
import { BloodUnitBatchService } from './batch/blood-unit-batch.service';

@Controller('blood-units')
export class BloodUnitsController {
  constructor(
    private readonly bloodUnitsService: BloodUnitsService,
    private readonly bloodStatusService: BloodStatusService,
    private readonly qrVerificationService: QrVerificationService,
    private readonly inventoryQueryService: BloodInventoryQueryService,
    private readonly batchService: BloodUnitBatchService,
  ) {}

  @RequirePermissions(Permission.REGISTER_BLOOD_UNIT)
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async registerBloodUnit(
    @Body() dto: RegisterBloodUnitDto,
    @Req()
    request: Request & {
      user?: {
        id: string;
        role: string;
      };
    },
  ) {
    return this.bloodUnitsService.registerBloodUnit(dto, request.user);
  }

  @RequirePermissions(Permission.REGISTER_BLOOD_UNIT)
  @Post('register/bulk')
  @HttpCode(HttpStatus.CREATED)
  async registerBloodUnitsBulk(
    @Body() dto: BulkRegisterBloodUnitsDto,
    @Req()
    request: Request & {
      user?: {
        id: string;
        role: string;
      };
    },
  ) {
    return this.bloodUnitsService.registerBloodUnitsBulk(dto, request.user);
  }

  @RequirePermissions(Permission.REGISTER_BLOOD_UNIT)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Batch import blood units from CSV',
    description:
      'Upload a CSV file (max 500 rows) with columns: blood_type, component, volume_ml, expires_at, ' +
      'collected_at (optional), organization_id (optional), donor_id (optional). ' +
      'Returns per-row results. Valid rows are committed in a single transaction; ' +
      'invalid rows are reported individually without rolling back valid ones.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 201,
    schema: {
      example: {
        created: 498,
        errors: 2,
        results: [
          { row: 1, status: 'created' },
          { row: 2, status: 'error', reason: 'Invalid blood_type "XX"' },
        ],
      },
    },
  })
  @ApiResponse({ status: 422, description: 'Batch exceeds 500 rows or CSV is empty' })
  async batchImport(
    @UploadedFile() file: Express.Multer.File,
    @Req() request: Request & { user?: { id: string; role: string; organizationId?: string } },
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No CSV file uploaded');
    }
    const organizationId = (request.user as any)?.organizationId ?? '';
    return this.batchService.importFromCsv(file.buffer, organizationId);
  }

  @RequirePermissions(Permission.TRANSFER_CUSTODY)
  @Post('transfer-custody')
  @HttpCode(HttpStatus.OK)
  async transferCustody(@Body() dto: TransferCustodyDto) {
    return this.bloodUnitsService.transferCustody(dto);
  }

  @RequirePermissions(Permission.LOG_TEMPERATURE)
  @Post('log-temperature')
  @HttpCode(HttpStatus.OK)
  async logTemperature(@Body() dto: LogTemperatureDto) {
    return this.bloodUnitsService.logTemperature(dto);
  }

  @RequirePermissions(Permission.VIEW_BLOODUNIT_TRAIL)
  @Get(':id/trail')
  async getUnitTrail(@Param('id', ParseIntPipe) id: number) {
    return this.bloodUnitsService.getUnitTrail(id);
  }

  /**
   * INTER-ORG TRANSFER: Step 1: Initiate
   */
  @RequirePermissions(Permission.TRANSFER_CUSTODY)
  @Post(':id/transfer')
  @HttpCode(HttpStatus.CREATED)
  async initiateTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { destinationOrgId: string; reason?: string },
    @Req() request: Request & { user: { id: string; role: string; organizationId?: string } },
  ) {
    return this.bloodUnitsService.initiateOrganizationTransfer(
      id,
      body.destinationOrgId,
      body.reason,
      request.user,
    );
  }

  /**
   * INTER-ORG TRANSFER: Step 2: Accept
   */
  @RequirePermissions(Permission.TRANSFER_CUSTODY)
  @Post(':id/transfer/accept')
  @HttpCode(HttpStatus.OK)
  async acceptTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request & { user: { id: string; role: string; organizationId?: string } },
  ) {
    return this.bloodUnitsService.acceptOrganizationTransfer(id, request.user);
  }


  @RequirePermissions(Permission.UPDATE_BLOOD_STATUS)
  @Auditable({ action: 'blood-unit.status-changed', resourceType: 'BloodUnit' })
  @UseInterceptors(AuditLogInterceptor)
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateBloodStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBloodStatusDto,
    @Req()
    request: Request & { user?: { id: string; role: string } },
  ) {
    return this.bloodStatusService.updateStatus(id, dto, request.user);
  }

  @RequirePermissions(Permission.UPDATE_BLOOD_STATUS)
  @Post(':id/reserve')
  @HttpCode(HttpStatus.OK)
  async reserveBloodUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReserveBloodUnitDto,
    @Req()
    request: Request & { user?: { id: string; role: string } },
  ) {
    return this.bloodStatusService.reserveUnit(id, dto, request.user);
  }

  @RequirePermissions(Permission.VIEW_BLOOD_STATUS_HISTORY)
  @Get(':id/status-history')
  async getStatusHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.bloodStatusService.getStatusHistory(id);
  }

  @RequirePermissions(Permission.UPDATE_BLOOD_STATUS)
  @Post('bulk/status')
  @HttpCode(HttpStatus.OK)
  async bulkUpdateStatus(
    @Body() dto: BulkUpdateBloodStatusDto,
    @Req()
    request: Request & { user?: { id: string; role: string } },
  ) {
    return this.bloodStatusService.bulkUpdateStatus(dto, request.user);
  }

  @RequirePermissions(Permission.UPDATE_BLOOD_STATUS)
  @Post('verify-qr')
  @HttpCode(HttpStatus.OK)
  async verifyQr(@Body() dto: VerifyQrDto) {
    return this.qrVerificationService.verify(dto);
  }

  @RequirePermissions(Permission.VIEW_BLOOD_STATUS_HISTORY)
  @Get('verify-qr/history/:orderId')
  async getVerificationHistory(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.qrVerificationService.getVerificationHistory(orderId);
  }

  @RequirePermissions(Permission.REGISTER_BLOOD_UNIT)
  @Get('inventory')
  async queryInventory(@Query() dto: QueryBloodInventoryDto) {
    return this.inventoryQueryService.query(dto);
  }

  @RequirePermissions(Permission.REGISTER_BLOOD_UNIT)
  @Get('inventory/statistics')
  async getInventoryStatistics(@Query('bankId') bankId?: string) {
    return this.inventoryQueryService.getStatistics(bankId);
  }

  @RequirePermissions(Permission.REGISTER_BLOOD_UNIT)
  @Get('inventory/availability')
  async checkAvailability(
    @Query('bloodType', new ParseEnumPipe(BloodType)) bloodType: BloodType,
    @Query('requiredVolumeMl', ParseIntPipe) requiredVolumeMl: number,
  ) {
    return this.inventoryQueryService.checkAvailability(
      bloodType,
      requiredVolumeMl,
    );
  }

  @Get('nearby')
  async findNearby(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius') radius: string,
    @Query('bloodType') bloodType?: BloodType,
  ) {
    if (!lat || !lng || !radius) {
      const errors: string[] = [];
      if (!lat) errors.push('lat is required');
      if (!lng) errors.push('lng is required');
      if (!radius) errors.push('radius is required');
      throw new BadRequestException(errors.join(', '));
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusKm = parseFloat(radius);

    if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusKm)) {
      throw new BadRequestException('lat, lng, and radius must be valid numbers');
    }

    return this.inventoryQueryService.findNearby({
      lat: latitude,
      lng: longitude,
      radiusKm,
      bloodType,
    });
  }
}

