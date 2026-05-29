import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';

import { PermissionsService } from '../auth/permissions.service';
import { DonorEligibilityService } from '../donor-eligibility/donor-eligibility.service';
import { NotificationChannel } from '../notifications/enums/notification-channel.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { BloodUnitTrail } from '../soroban/entities/blood-unit-trail.entity';
import { SorobanService } from '../soroban/soroban.service';

import {
  BulkRegisterBloodUnitsDto,
  RegisterBloodUnitDto,
  TransferCustodyDto,
  LogTemperatureDto,
} from './dto/blood-units.dto';
import { BloodUnitEntity } from './entities/blood-unit.entity';

interface AuthenticatedUserContext {
  id: string;
  role: string;
  organizationId?: string;
}

@Injectable()
export class BloodUnitsService {
  private readonly logger = new Logger(BloodUnitsService.name);

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly notificationsService: NotificationsService,
    private readonly permissionsService: PermissionsService,
    private readonly donorEligibilityService: DonorEligibilityService,
    @InjectRepository(BloodUnitTrail)
    private readonly trailRepository: Repository<BloodUnitTrail>,
    @InjectRepository(BloodUnitEntity)
    private readonly bloodUnitRepository: Repository<BloodUnitEntity>,
  ) {}

  async registerBloodUnit(
    dto: RegisterBloodUnitDto,
    user?: AuthenticatedUserContext,
  ) {
    this.validateExpirationDate(dto.expirationDate);
    await this.validateBloodBankAuthorization(dto.bankId, user);

    // Block registration if donor is not eligible
    if (dto.donorId) {
      await this.donorEligibilityService.assertEligible(dto.donorId);
    }

    const unitNumber = await this.generateUniqueUnitNumber(dto.bloodType);
    const expirationTimestamp = Math.floor(
      new Date(dto.expirationDate).getTime() / 1000,
    );

    const result = await this.sorobanService.registerBloodUnit({
      bankId: dto.bankId,
      bloodType: dto.bloodType,
      quantityMl: dto.quantityMl,
      expirationTimestamp,
      donorId: dto.donorId,
    });

    const barcodeData = await this.generateBarcode({
      unitNumber,
      bloodType: dto.bloodType,
      quantityMl: dto.quantityMl,
      bankId: dto.bankId,
      expirationDate: dto.expirationDate,
      blockchainTransactionHash: result.transactionHash,
      blockchainUnitId: result.unitId,
    });

    const savedUnit = await this.bloodUnitRepository.save(
      this.bloodUnitRepository.create({
        unitNumber,
        bloodType: dto.bloodType,
        quantityMl: dto.quantityMl,
        donorId: dto.donorId,
        bankId: dto.bankId,
        expirationDate: new Date(dto.expirationDate),
        registeredBy: user?.id,
        blockchainTransactionHash: result.transactionHash,
        blockchainUnitId: result.unitId,
        barcodeData,
        metadata: dto.metadata,
      }),
    );

    await this.sendRegistrationNotification(savedUnit);

    return {
      success: true,
      unitNumber: savedUnit.unitNumber,
      blockchainUnitId: result.unitId,
      blockchainTransactionHash: result.transactionHash,
      barcodeData: savedUnit.barcodeData,
      message: 'Blood unit registered successfully',
    };
  }

  async registerBloodUnitsBulk(
    dto: BulkRegisterBloodUnitsDto,
    user?: AuthenticatedUserContext,
  ) {
    const results = await Promise.allSettled(
      dto.units.map((unit) => this.registerBloodUnit(unit, user)),
    );

    const successful = results.filter((entry) => entry.status === 'fulfilled');
    const failed = results.filter((entry) => entry.status === 'rejected');

    return {
      success: failed.length === 0,
      total: dto.units.length,
      successful: successful.length,
      failed: failed.length,
      units: successful.map((entry) => entry.value),
      errors: failed.map((entry, index) => ({
        index,
        message:
          entry.reason instanceof Error
            ? entry.reason.message
            : 'Unknown error',
      })),
    };
  }

  async transferCustody(dto: TransferCustodyDto) {
    const result = await this.sorobanService.transferCustody({
      unitId: dto.unitId,
      fromAccount: dto.fromAccount,
      toAccount: dto.toAccount,
      condition: dto.condition,
    });

    return {
      success: true,
      transactionHash: result.transactionHash,
      message: 'Custody transferred successfully',
    };
  }

  async logTemperature(dto: LogTemperatureDto) {
    const result = await this.sorobanService.logTemperature({
      unitId: dto.unitId,
      temperature: dto.temperature,
      timestamp: dto.timestamp || Math.floor(Date.now() / 1000),
      bloodType: dto.bloodType,
    });

    return {
      success: true,
      transactionHash: result.transactionHash,
      message: 'Temperature logged successfully',
    };
  }

  async getUnitTrail(unitId: number) {
    // Try to get from database first (cached)
    const cachedTrail = await this.trailRepository.findOne({
      where: { unitId },
    });

    if (cachedTrail) {
      return {
        unitId,
        custodyTrail: cachedTrail.custodyTrail,
        temperatureLogs: cachedTrail.temperatureLogs,
        statusHistory: cachedTrail.statusHistory,
        lastUpdated: cachedTrail.lastSyncedAt,
        source: 'cache',
      };
    }

    // If not in cache, fetch from blockchain
    try {
      const trail = await this.sorobanService.getUnitTrail(unitId);

      return {
        unitId,
        ...trail,
        lastUpdated: new Date(),
        source: 'blockchain',
      };
    } catch (error) {
      throw new NotFoundException(`Blood unit ${unitId} not found`);
    }
  }

  private validateExpirationDate(expirationDate: string) {
    const parsed = new Date(expirationDate);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Expiration date must be a valid future date',
      );
    }
  }

  private async validateBloodBankAuthorization(
    bankId: string,
    user?: AuthenticatedUserContext,
  ) {
    const isAuthorizedBank = await this.sorobanService.isBloodBank(bankId);
    if (!isAuthorizedBank) {
      throw new NotFoundException('Blood bank is not authorized on blockchain');
    }

    if (user?.role) {
      this.permissionsService.assertIsBloodBankOrAdmin(user);
    }
  }

  private async generateUniqueUnitNumber(bloodType: string): Promise<string> {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = this.generateUnitNumber(bloodType);
      const existing = await this.bloodUnitRepository.findOne({
        where: { unitNumber: candidate },
        select: ['id'],
      });

      if (!existing) {
        return candidate;
      }
    }

    throw new BadRequestException('Unable to generate a unique unit number');
  }

  private generateUnitNumber(bloodType: string): string {
    const normalizedType = bloodType.replace('+', 'POS').replace('-', 'NEG');
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${normalizedType}-${timestamp}-${random}`;
  }

  private async generateBarcode(payload: Record<string, unknown>) {
    return QRCode.toDataURL(JSON.stringify(payload), {
      margin: 1,
      width: 320,
    });
  }

  private async sendRegistrationNotification(unit: BloodUnitEntity) {
    try {
      await this.notificationsService.send({
        recipientId: unit.bankId,
        channels: [NotificationChannel.IN_APP],
        templateKey: 'blood_unit_registered',
        variables: {
          unitNumber: unit.unitNumber,
          bloodType: unit.bloodType,
          quantityMl: String(unit.quantityMl),
          expirationDate: unit.expirationDate.toISOString(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Notification skipped for blood unit ${unit.unitNumber}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
