import { randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { UserRole } from '../auth/enums/user-role.enum';
import { PermissionsService } from '../auth/permissions.service';
import { LIFEBANK_REQUESTS_METHODS } from '../blockchain/contracts/lifebank-contracts';
import { SorobanService } from '../blockchain/services/soroban.service';
import { CompensationService } from '../common/compensation/compensation.service';
import {
  BloodRequestIrrecoverableError,
  CompensationAction,
} from '../common/errors/app-errors';
import { InventoryService } from '../inventory/inventory.service';

import { CreateBloodRequestDto } from './dto/create-blood-request.dto';
import {
  BloodRequestItemEntity,
  ItemPriority,
} from './entities/blood-request-item.entity';
import { BloodRequestEntity, RequestUrgency } from './entities/blood-request.entity';
import { RequestStatusHistoryEntity } from './entities/request-status-history.entity';
import { RequestStatus, BloodRequestStatus } from './enums/blood-request-status.enum';
import { UrgencyLevel } from './enums/urgency-level.enum';
import { TriageScoringService } from './services/triage-scoring.service';
import {
  BLOOD_REQUEST_QUEUE,
  QUEUE_PRIORITY,
  RequestUrgency as QueueRequestUrgency,
} from './enums/request-urgency.enum';
import { BloodRequestJobData } from './processors/blood-request.processor';
import { BloodRequestChainService } from './services/blood-request-chain.service';
import { BloodRequestEmailService } from './services/blood-request-email.service';

type RequestUser = { id: string; role: UserRole; email: string };

@Injectable()
export class BloodRequestsService {
  private readonly logger = new Logger(BloodRequestsService.name);

  constructor(
    @InjectRepository(BloodRequestEntity)
    private readonly bloodRequestRepo: Repository<BloodRequestEntity>,
    @InjectRepository(BloodRequestItemEntity)
    private readonly bloodRequestItemRepo: Repository<BloodRequestItemEntity>,
    @InjectRepository(RequestStatusHistoryEntity)
    private readonly requestStatusHistoryRepo: Repository<RequestStatusHistoryEntity>,
    private readonly inventoryService: InventoryService,
    private readonly sorobanService: SorobanService,
    private readonly compensationService: CompensationService,
    private readonly chainService: BloodRequestChainService,
    private readonly emailService: BloodRequestEmailService,
    private readonly permissionsService: PermissionsService,
    private readonly triageScoringService: TriageScoringService,
    @InjectQueue(BLOOD_REQUEST_QUEUE)
    private readonly queue: Queue<BloodRequestJobData>,
  ) {}

  // ── Private helpers ────────────────────────────────────────────────────────

  private assertHospitalAuthorization(user: RequestUser, hospitalId: string): void {
    if (user.role === UserRole.HOSPITAL) {
      this.permissionsService.assertIsAdminOrSelf(
        user,
        hospitalId,
        'Hospital accounts may only create blood requests where hospitalId matches their user id.',
      );
    }
  }

  private assertRequiredByFuture(requiredByIso: string): Date {
    const requiredBy = new Date(requiredByIso);
    if (Number.isNaN(requiredBy.getTime())) {
      throw new BadRequestException('requiredBy must be a valid ISO 8601 date-time');
    }
    if (requiredBy.getTime() <= Date.now()) {
      throw new BadRequestException('requiredBy must be in the future');
    }
    return requiredBy;
  }

  private async allocateRequestNumber(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const suffix = randomBytes(3).toString('hex').toUpperCase();
      const requestNumber = `BR-${Date.now()}-${suffix}`;
      const exists = await this.bloodRequestRepo.exist({ where: { requestNumber } });
      if (!exists) return requestNumber;
    }
    throw new Error('Unable to allocate a unique request number');
  }

  private calculateSlaResponseDueAt(urgencyLevel: UrgencyLevel): Date {
    const urgencyToHours: Record<UrgencyLevel, number> = {
      [UrgencyLevel.CRITICAL]: 1,
      [UrgencyLevel.URGENT]: 4,
      [UrgencyLevel.ROUTINE]: 24,
      [UrgencyLevel.SCHEDULED]: 72,
    };
    const deadline = new Date();
    deadline.setHours(deadline.getHours() + urgencyToHours[urgencyLevel]);
    return deadline;
  }

  private mapUrgencyLevelToRequestUrgency(level: UrgencyLevel): RequestUrgency {
    const map: Record<UrgencyLevel, RequestUrgency> = {
      [UrgencyLevel.CRITICAL]: RequestUrgency.CRITICAL,
      [UrgencyLevel.URGENT]: RequestUrgency.URGENT,
      [UrgencyLevel.ROUTINE]: RequestUrgency.ROUTINE,
      [UrgencyLevel.SCHEDULED]: RequestUrgency.SCHEDULED,
    };
    return map[level] ?? RequestUrgency.ROUTINE;
  }

  private async enqueue(saved: BloodRequestEntity): Promise<void> {
    const urgency = (saved.urgency as unknown as QueueRequestUrgency) ?? QueueRequestUrgency.ROUTINE;
    await this.queue.add(
      'process-request',
      { requestId: saved.id, urgency, enqueuedAt: Date.now() },
      {
        priority: QUEUE_PRIORITY[urgency],
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async create(
    dto: CreateBloodRequestDto,
    user: RequestUser,
  ): Promise<{ message: string; data: BloodRequestEntity }> {
    this.assertHospitalAuthorization(user, dto.hospitalId);
    const requiredBy = this.assertRequiredByFuture(dto.requiredBy);
    const urgencyLevel = dto.urgencyLevel ?? UrgencyLevel.ROUTINE;
    const urgency = dto.urgency ?? this.mapUrgencyLevelToRequestUrgency(urgencyLevel);
    const slaResponseDueAt = this.calculateSlaResponseDueAt(urgencyLevel);

    const requestNumber = await this.allocateRequestNumber();
    const reserved: Array<{ bloodBankId: string; bloodType: string; quantity: number }> = [];

    try {
      // 1. Reserve inventory for each item
      for (const item of dto.items) {
        const bloodType = item.bloodType.trim();
        const quantity = item.quantityMl ?? item.quantity;
        const bloodBankId = item.bloodBankId || dto.hospitalId;
        if (!quantity) {
          throw new BadRequestException(
            'Item quantity must be specified as quantityMl or quantity',
          );
        }
        await this.inventoryService.reserveStockOrThrow(bloodBankId, bloodType, quantity);
        reserved.push({ bloodBankId, bloodType, quantity });
      }

      // 2. Submit to blockchain
      const chainPayload = dto.items.map((i) => ({
        bloodBankId: i.bloodBankId || dto.hospitalId,
        bloodType: i.bloodType.trim(),
        quantity: i.quantityMl ?? i.quantity,
      }));

      let transactionHash: string;
      try {
        const chainResult = await this.sorobanService.submitTransactionAndWait({
          contractMethod: LIFEBANK_REQUESTS_METHODS.createRequest,
          args: [requestNumber, dto.hospitalId, JSON.stringify(chainPayload)],
          idempotencyKey: `blood-request:${requestNumber}`,
          metadata: { requestNumber, hospitalId: dto.hospitalId },
        });
        transactionHash = chainResult.transactionHash;
      } catch (err) {
        // Blockchain failure — compensate inventory reservations
        const irrecoverableErr = new BloodRequestIrrecoverableError(
          `Soroban ${LIFEBANK_REQUESTS_METHODS.createRequest} failed for ${requestNumber}`,
          { requestNumber, hospitalId: dto.hospitalId, reservedItems: reserved },
          err,
        );

        const releaseHandlers = reserved.map((r) => ({
          action: CompensationAction.REVERT_INVENTORY,
          execute: async () => {
            await this.inventoryService.releaseStockByBankAndType(
              r.bloodBankId,
              r.bloodType,
              r.quantity,
            );
            return true;
          },
        }));

        const notifyHandler = {
          action: CompensationAction.NOTIFY_USER,
          execute: async () => {
            try {
              await this.emailService.sendCreationConfirmationFailure(
                user.email,
                requestNumber,
              );
              return true;
            } catch {
              return false;
            }
          },
        };

        const adminAlertHandler = {
          action: CompensationAction.NOTIFY_ADMIN,
          execute: () => {
            this.logger.error(`[ADMIN ALERT] Blood request on-chain failure`, {
              requestNumber,
              hospitalId: dto.hospitalId,
            });
            return true;
          },
        };

        const flagHandler = {
          action: CompensationAction.FLAG_FOR_REVIEW,
          execute: () => true,
        };

        const result = await this.compensationService.compensate(
          irrecoverableErr,
          [...releaseHandlers, notifyHandler, adminAlertHandler, flagHandler],
          `blood-request:${requestNumber}`,
        );

        irrecoverableErr.context['failureRecordId'] = result.failureRecordId;
        throw irrecoverableErr;
      }

      // 3. Compute triage score
      const totalRequestedUnits = dto.items.reduce(
        (sum, i) => sum + (i.quantityMl ?? i.quantity ?? 0),
        0,
      );
      const highestPriority = dto.items.reduce<ItemPriority>((highest, i) => {
        const priorityOrder: Record<string, number> = {
          CRITICAL: 4,
          HIGH: 3,
          NORMAL: 2,
          LOW: 1,
        };
        const current = (i.priority as ItemPriority) ?? ItemPriority.NORMAL;
        return (priorityOrder[current] ?? 2) > (priorityOrder[highest] ?? 2) ? current : highest;
      }, ItemPriority.NORMAL);

      const triage = this.triageScoringService.compute({
        urgency,
        itemPriority: highestPriority,
        requestedUnits: totalRequestedUnits,
        availableUnits: totalRequestedUnits, // will be refined async
        requiredByTimestamp: Math.floor(requiredBy.getTime() / 1000),
        currentTimestamp: Math.floor(Date.now() / 1000),
      });

      // 4. Persist request
      const now = Math.floor(Date.now() / 1000);
      const items = dto.items.map((i) =>
        this.bloodRequestItemRepo.create({
          bloodType: i.bloodType.trim() as any,
          component: i.component as any,
          quantityMl: i.quantityMl ?? i.quantity ?? 0,
          priority: (i.priority as ItemPriority) ?? ItemPriority.NORMAL,
          compatibilityNotes: i.compatibilityNotes,
        }),
      );

      const statusHistory = [
        this.requestStatusHistoryRepo.create({
          previousStatus: null,
          newStatus: RequestStatus.PENDING,
          reason: 'Request created',
          changedByUserId: user.id,
        }),
      ];

      const bloodRequest = this.bloodRequestRepo.create({
        requestNumber,
        hospitalId: dto.hospitalId,
        urgency,
        createdTimestamp: now,
        requiredByTimestamp: Math.floor(requiredBy.getTime() / 1000),
        status: RequestStatus.PENDING,
        statusUpdatedAt: new Date(),
        slaResponseDueAt,
        slaFulfillmentDueAt: requiredBy,
        blockchainRequestId: requestNumber,
        blockchainNetwork: 'stellar',
        blockchainTxHash: transactionHash,
        blockchainConfirmedAt: new Date(),
        deliveryAddress: dto.deliveryAddress?.trim() ?? null,
        notes: dto.notes?.trim() ?? null,
        createdByUserId: user.id,
        triageScore: triage.score,
        triagePolicyVersion: triage.policyVersion,
        triageFactors: triage.factors,
        items,
        statusHistory,
      } as Partial<BloodRequestEntity>);

      const saved = await this.bloodRequestRepo.save(bloodRequest);

      // 5. Enqueue for processing
      await this.enqueue(saved);

      // 6. Send confirmation email
      await this.emailService.sendCreationConfirmation(user.email, saved);

      return { message: 'Blood request created successfully', data: saved };
    } catch (err) {
      // Roll back inventory if error is NOT already handled by compensation
      if (!(err instanceof BloodRequestIrrecoverableError)) {
        for (const r of [...reserved].reverse()) {
          try {
            await this.inventoryService.releaseStockByBankAndType(
              r.bloodBankId,
              r.bloodType,
              r.quantity,
            );
          } catch (releaseErr) {
            this.logger.error(
              `Failed to release reservation for ${r.bloodBankId}/${r.bloodType}: ${(releaseErr as Error).message}`,
            );
          }
        }
      }
      throw err;
    }
  }
}
