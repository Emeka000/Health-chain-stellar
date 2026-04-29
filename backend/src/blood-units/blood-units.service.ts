import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';

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
    @InjectRepository(BloodUnit)
    private readonly inventoryRepository: Repository<BloodUnit>,
    @InjectRepository(TransferRecord)
    private readonly transferRepository: Repository<TransferRecord>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepository: Repository<OrganizationEntity>,
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
    const unit = await this.inventoryRepository.findOne({
      where: { id: unitId },
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
    await this.inventoryRepository.save(unit);

    const transfer = this.transferRepository.create({
      bloodUnitId: unitId,
      sourceOrgId: unit.organizationId,
      destinationOrgId,
      reason,
      status: TransferStatus.PENDING,
      initiatedByUserId: user?.id,
    });
    await this.transferRepository.save(transfer);

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

  /**
   * Phase 2 of inter-org transfer: Accept.
   * Status transitions back to AVAILABLE (at new org).
   * Closes #465
   */
  async acceptOrganizationTransfer(unitId: string, user?: AuthenticatedUserContext) {
    const unit = await this.inventoryRepository.findOne({
      where: { id: unitId },
    });

    if (!unit) {
      throw new NotFoundException(`Blood unit ${unitId} not found`);
    }

    const transfer = await this.transferRepository.findOne({
      where: {
        bloodUnitId: unitId,
        status: TransferStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });

    if (!transfer) {
      throw new BadRequestException('No pending transfer found for this unit');
    }

    // Must be destination org
    if (transfer.destinationOrgId !== (user as any)?.organizationId && user?.role !== 'admin') {
      throw new BadRequestException('Only the destination organization can accept the transfer');
    }

    const previousOrgId = unit.organizationId;
    unit.organizationId = transfer.destinationOrgId;
    unit.status = BloodStatus.AVAILABLE;
    await this.inventoryRepository.save(unit);

    transfer.status = TransferStatus.ACCEPTED;
    transfer.acceptedByUserId = user?.id || null;
    transfer.acceptedAt = new Date();
    await this.transferRepository.save(transfer);

    // Update Soroban - publish custody transfer to blockchain
    try {
      if (unit.blockchainUnitId) {
        const [sourceOrg, destOrg] = await Promise.all([
          this.orgRepository.findOne({ where: { id: previousOrgId } }),
          this.orgRepository.findOne({ where: { id: unit.organizationId } }),
        ]);

        if (sourceOrg?.blockchainAddress && destOrg?.blockchainAddress) {
          // Verify both orgs are still registered actors before the on-chain call
          await this.validateCustodyTransferActors(
            sourceOrg.blockchainAddress,
            destOrg.blockchainAddress,
          );
          await this.sorobanService.transferCustody({
            unitId: Number(unit.blockchainUnitId),
            fromAccount: sourceOrg.blockchainAddress,
            toAccount: destOrg.blockchainAddress,
            condition: 'Inter-Organization Transfer',
          });
        }
      }
    } catch (error) {
       this.logger.warn(`Failed to sync transfer acceptance to Soroban for unit ${unitId}: ${error.message}`);
    }

    this.eventEmitter.emit('blood-unit.transfer.accepted', {

      unitId,
      transferId: transfer.id,
      sourceOrgId: previousOrgId,
      destinationOrgId: unit.organizationId,
      acceptedBy: user?.id,
    });

    return {
      success: true,
      unitId,
      newOrganizationId: unit.organizationId,
    };
  }


  async logTemperature(dto: LogTemperatureDto) {
    const matchedUnit = await this.findByBlockchainUnitId(dto.unitId);

    const result = await this.sorobanService.logTemperature({
      unitId: dto.unitId,
      temperature: dto.temperature,
      timestamp: dto.timestamp || Math.floor(Date.now() / 1000),
      bloodType: dto.bloodType,
    });

    if (
      matchedUnit &&
      (dto.temperature < this.minStorageTempC ||
        dto.temperature > this.maxStorageTempC)
    ) {
      try {
        await this.quarantineService.createCase(
          {
            bloodUnitId: matchedUnit.id,
            triggerSource: QuarantineTriggerSource.TEMPERATURE_BREACH,
            reasonCode: QuarantineReasonCode.STORAGE_ANOMALY,
            reason: `Temperature ${dto.temperature}C breached threshold [${this.minStorageTempC}, ${this.maxStorageTempC}]`,
            metadata: {
              onChainUnitId: dto.unitId,
              observedTemperature: dto.temperature,
              threshold: {
                min: this.minStorageTempC,
                max: this.maxStorageTempC,
              },
            },
            evidence: [
              {
                type: 'temperature_log',
                fileId: `temp-log-${dto.unitId}-${Date.now()}`,
                description: `Temperature reading: ${dto.temperature}C`,
              },
            ],
          },
          undefined,
        );
      } catch (error) {
        this.logger.warn(
          `Temperature breach quarantine trigger failed for unit ${matchedUnit.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

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
    // Verify against the authoritative organisation registry first
    await this.actorRegistry.assertActorType(bankId, ActorType.BLOOD_BANK);

    // Secondary on-chain check (belt-and-suspenders)
    const isAuthorizedBank = await this.sorobanService.isBloodBank(bankId);
    if (!isAuthorizedBank) {
      throw new NotFoundException('Blood bank is not authorized on blockchain');
    }

    if (user?.role) {
      this.permissionsService.assertIsBloodBankOrAdmin(user);
    }
  }

  /**
   * Verify that both custody-transfer endpoints are registered actors of the
   * correct type before the on-chain call is submitted.
   */
  private async validateCustodyTransferActors(
    fromAccount: string,
    toAccount: string,
  ): Promise<void> {
    // Both sides must be verified organisations (blood bank or hospital)
    const [fromOk, toOk] = await Promise.all([
      this.actorRegistry.isVerifiedActor(fromAccount, ActorType.BLOOD_BANK).then(
        (ok) => ok || this.actorRegistry.isVerifiedActor(fromAccount, ActorType.HOSPITAL),
      ),
      this.actorRegistry.isVerifiedActor(toAccount, ActorType.BLOOD_BANK).then(
        (ok) => ok || this.actorRegistry.isVerifiedActor(toAccount, ActorType.HOSPITAL),
      ),
    ]);

    if (!fromOk) {
      throw new ForbiddenException(
        `Source actor '${fromAccount}' is not a verified blood bank or hospital.`,
      );
    }
    if (!toOk) {
      throw new ForbiddenException(
        `Destination actor '${toAccount}' is not a verified blood bank or hospital.`,
      );
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

  private async findByBlockchainUnitId(
    blockchainUnitId: number,
  ): Promise<BloodUnitEntity | null> {
    return this.bloodUnitRepository.findOne({
      where: {
        blockchainUnitId: blockchainUnitId as unknown as any,
      },
    });
  }

  private async assertUnitTransferable(blockchainUnitId: number): Promise<void> {
    const unit = await this.findByBlockchainUnitId(blockchainUnitId);
    if (!unit) {
      return;
    }

    const normalizedStatus = String((unit as unknown as { status?: string }).status || '').toUpperCase();
    if (normalizedStatus === BloodStatus.QUARANTINED) {
      throw new BadRequestException(
        `Blood unit ${unit.unitNumber} is quarantined and cannot be transferred`,
      );
    }
  }
}
