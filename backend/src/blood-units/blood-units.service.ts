import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import * as QRCode from 'qrcode';
import { DataSource, Repository } from 'typeorm';

import { PermissionsService } from '../auth/permissions.service';
import { DonorEligibilityService } from '../donor-eligibility/donor-eligibility.service';
import { NotificationChannel } from '../notifications/enums/notification-channel.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { ActorRegistryService, ActorType } from '../registry/actor-registry.service';
import { BloodUnitTrail } from '../soroban/entities/blood-unit-trail.entity';
import { SorobanService } from '../soroban/soroban.service';

import {
  BulkRegisterBloodUnitsDto,
  RegisterBloodUnitDto,
  TransferCustodyDto,
  LogTemperatureDto,
} from './dto/blood-units.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransferRecord, TransferStatus } from './entities/transfer-record.entity';
import { BloodUnit, BloodUnitEntity } from './entities/blood-unit.entity';
import { BloodStatus } from './enums/blood-status.enum';
import { QuarantineReasonCode, QuarantineTriggerSource } from './enums/quarantine.enums';
import { QuarantineService } from './services/quarantine.service';
import { OrganizationEntity } from '../organizations/entities/organization.entity';




interface AuthenticatedUserContext {
  id: string;
  role: string;
  organizationId?: string;
}

@Injectable()
export class BloodUnitsService {
  private readonly logger = new Logger(BloodUnitsService.name);
  private readonly minStorageTempC = 1;
  private readonly maxStorageTempC = 6;

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly notificationsService: NotificationsService,
    private readonly permissionsService: PermissionsService,
    private readonly donorEligibilityService: DonorEligibilityService,
    private readonly quarantineService: QuarantineService,
    private readonly actorRegistry: ActorRegistryService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(BloodUnitTrail)

    private readonly trailRepository: Repository<BloodUnitTrail>,
    @InjectRepository(BloodUnitEntity)
    private readonly bloodUnitRepository: Repository<BloodUnitEntity>,
    @InjectRepository(TransferRecord)
    private readonly transferRepository: Repository<TransferRecord>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepository: Repository<OrganizationEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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

    const result = await this.sorobanService.registerBloodUnit({
      bankId: dto.bankId,
      serialNumber: unitNumber,
      bloodType: dto.bloodType,
      quantityMl: dto.quantityMl,
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

  private validateExpirationDate(expirationDate: string | Date): void {
    const expiry = new Date(expirationDate);
    if (Number.isNaN(expiry.getTime())) {
      throw new BadRequestException('Invalid expiration date');
    }
    if (expiry.getTime() <= Date.now()) {
      throw new BadRequestException('Expiration date must be in the future');
    }
  }

  private async validateBloodBankAuthorization(
    bankId: string,
    user?: AuthenticatedUserContext,
  ): Promise<void> {
    if (!user) {
      throw new ForbiddenException('Authentication required to register blood units');
    }

    if (user.role === 'admin') {
      return;
    }

    if (user.organizationId && user.organizationId === bankId) {
      return;
    }

    const authorized = await this.permissionsService.hasPermission(
      user.id,
      'blood-units:register',
    );
    if (!authorized) {
      throw new ForbiddenException(
        'You are not authorized to register blood units for this blood bank',
      );
    }
  }

  private async generateUniqueUnitNumber(bloodType: string): Promise<string> {
    const prefix = `BU-${bloodType.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`;
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const random = Math.random().toString(36).slice(2, 8).toUpperCase();
      const candidate = `${prefix}-${Date.now().toString(36).toUpperCase()}-${random}`;
      const existing = await this.bloodUnitRepository.findOne({
        where: { unitNumber: candidate },
      });
      if (!existing) {
        return candidate;
      }
    }

    throw new ServiceUnavailableException(
      'Unable to generate a unique blood unit number, please retry',
    );
  }

  private async generateBarcode(data: {
    unitNumber: string;
    bloodType: string;
    quantityMl: number;
    bankId: string;
    expirationDate: string | Date;
    blockchainTransactionHash?: string;
    blockchainUnitId?: string;
  }): Promise<string> {
    const payload = JSON.stringify({
      unitNumber: data.unitNumber,
      bloodType: data.bloodType,
      quantityMl: data.quantityMl,
      bankId: data.bankId,
      expirationDate: new Date(data.expirationDate).toISOString(),
      blockchainTransactionHash: data.blockchainTransactionHash,
      blockchainUnitId: data.blockchainUnitId,
    });

    return QRCode.toDataURL(payload);
  }

  private async sendRegistrationNotification(unit: BloodUnitEntity): Promise<void> {
    try {
      await this.notificationsService.send({
        channel: NotificationChannel.EMAIL,
        recipientId: unit.registeredBy,
        template: 'blood-unit-registered',
        data: {
          unitNumber: unit.unitNumber,
          bloodType: unit.bloodType,
          quantityMl: unit.quantityMl,
          bankId: unit.bankId,
          expirationDate: unit.expirationDate,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send registration notification for unit ${unit.unitNumber}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
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
    await this.assertUnitTransferable(dto.unitId);
    await this.validateCustodyTransferActors(dto.fromAccount, dto.toAccount);

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

  /**
   * Phase 1 of inter-org transfer: Initiate.
   * Status transitions to IN_TRANSFER.
   * Closes #465
   */
  async initiateOrganizationTransfer(
    unitId: string,
    destinationOrgId: string,
    reason?: string,
    user?: AuthenticatedUserContext,
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let unit: BloodUnit;
    let transfer: TransferRecord;

    try {
      unit = await queryRunner.manager.findOne(BloodUnit, {
        where: { id: unitId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!unit) {
        throw new NotFoundException(`Blood unit ${unitId} not found`);
      }

      // Must be owner org
      if (unit.organizationId !== (user as any)?.organizationId && user?.role !== 'admin') {
        throw new BadRequestException('Only the owner organization can initiate a transfer');
      }

      if (unit.status !== BloodStatus.AVAILABLE) {
        throw new BadRequestException(`Unit must be AVAILABLE to transfer (current: ${unit.status})`);
      }

      unit.status = BloodStatus.IN_TRANSFER;
      await queryRunner.manager.save(unit);

      transfer = queryRunner.manager.create(TransferRecord, {
        bloodUnitId: unitId,
        sourceOrgId: unit.organizationId,
        destinationOrgId,
        reason,
        status: TransferStatus.PENDING,
        initiatedByUserId: user?.id,
      });
      await queryRunner.manager.save(transfer);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    this.eventEmitter.emit('blood-unit.transfer.initiated', {
      unitId,
      transferId: transfer.id,
      sourceOrgId: unit.organizationId,
      destinationOrgId,
      initiatedBy: user?.id,
    });

    return {
      success: true,
      transferId: transfer.id,
      status: unit.status,
    };
  }
