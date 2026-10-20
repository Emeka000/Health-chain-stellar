import { randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { UserRole } from '../auth/enums/user-role.enum';
import { PermissionsService } from '../auth/permissions.service';
import { RestrictionLevel } from '../organizations/enums/org-lifecycle.enum';
import { OrgVerificationLifecycleService } from '../organizations/services/org-verification-lifecycle.service';
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
import {
  BloodRequestEntity,
  RequestUrgency,
} from './entities/blood-request.entity';
import { RequestStatusHistoryEntity } from './entities/request-status-history.entity';
import {
  RequestStatus,
  BloodRequestStatus,
} from './enums/blood-request-status.enum';
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
    private readonly orgVerificationLifecycleService: OrgVerificationLifecycleService,
    private readonly compensationService: CompensationService,
    private readonly chainService: BloodRequestChainService,
    private readonly emailService: BloodRequestEmailService,
    private readonly permissionsService: PermissionsService,
    private readonly triageScoringService: TriageScoringService,
    @InjectQueue(BLOOD_REQUEST_QUEUE)
    private readonly queue: Queue<BloodRequestJobData>,
  ) {}

  // ── Private helpers ────────────────────────────────────────────────────────

  private assertHospitalAuthorization(
    user: RequestUser,
    hospitalId: string,
  ): void {
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
      throw new BadRequestException(
        'requiredBy must be a valid ISO 8601 date-time',
      );
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
      const exists = await this.bloodRequestRepo.exist({
        where: { requestNumber },
      });
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

  private resolveQueuePriority(urgency: QueueRequestUrgency): number {
    const priority = QUEUE_PRIORITY[urgency];
    if (priority === undefined) {
      throw new Error(
        `No queue priority configured for urgency "${urgency}"`,
      );
    }
    return priority;
  }

  private async enqueue(saved: BloodRequestEntity): Promise<void> {
    const urgency =
      (saved.urgency as unknown as QueueRequestUrgency) ??
      QueueRequestUrgency.ROUTINE;
    await this.queue.add(
      'process-request',
      { requestId: saved.id, urgency, enqueuedAt: Date.now() },
      {
        priority: this.resolveQueuePriority(urgency),
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
    const restriction =
      await this.orgVerificationLifecycleService.getRestrictionLevel(
        dto.hospitalId,
      );
    if (restriction !== RestrictionLevel.NONE) {
      throw new BadRequestException(
        'This hospital is restricted from creating new blood requests',
      );
    }
    const requiredBy = this.assertRequiredByFuture(dto.requiredBy);
    const urgencyLevel = dto.urgencyLevel ?? UrgencyLevel.ROUTINE;
    const urgency =
      dto.urgency ?? this.mapUrgencyLevelToRequestUrgency(urgencyLevel);
    const slaResponseDueAt = this.calculateSlaResponseDueAt(urgencyLevel);

    const requestNumber = await this.allocateRequestNumber();
    const reserved: Array<{
      bloodBankId: string;
      bloodType: string;
      component: string;
      quantity: number;
    }> = [];

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
        await this.inventoryService.reserveStockOrThrow(
          bloodBankId,
          bloodType,
          quantity,
          undefined,
          item.component
        );
        reserved.push({ bloodBankId, bloodType, component: item.component, quantity });
      }

      // 2. Submit to blockchain
      const chainPayload = dto.items.map((i) => ({
        bloodBankId: i.bloodBankId || dto.hospitalId,
        bloodType: i.bloodType.trim(),
        component: i.component,
        quantity: i.quantityMl ?? i.quantity,
      }));

      const idempotencyKey = `blood-request:${requestNumber}`;
      const chainResult = await this.sorobanService.invokeContractMethod({
        contractId: LIFEBANK_REQUESTS_METHODS.CONTRACT_ID,
        method: LIFEBANK_REQUESTS_METHODS.CREATE_REQUEST,
        args: {
          requestNumber,
          hospitalId: dto.hospitalId,
          requiredBy: requiredBy.toISOString(),
          urgency,
          items: chainPayload,
          idempotencyKey,
        },
      });

      // 3. Persist the request and its items
      const request = this.bloodRequestRepo.create({
        requestNumber,
        hospitalId: dto.hospitalId,
        requiredBy,
        urgency,
        urgencyLevel,
        status: RequestStatus.PENDING,
        slaResponseDueAt,
        chainRequestId: chainResult?.requestId ?? null,
        idempotencyKey,
        notes: dto.notes ?? null,
        createdBy: user.id,
      });
      const saved = await this.bloodRequestRepo.save(request);

      const items = dto.items.map((item, index) =>
        this.bloodRequestItemRepo.create({
          requestId: saved.id,
          bloodType: item.bloodType.trim(),
          component: item.component,
          quantityMl: item.quantityMl ?? item.quantity,
          bloodBankId: item.bloodBankId || dto.hospitalId,
          priority: item.priority ?? ItemPriority.ROUTINE,
          chainItemId: chainResult?.itemIds?.[index] ?? null,
        }),
      );
      await this.bloodRequestItemRepo.save(items);

      // 4. Write status history
      await this.requestStatusHistoryRepo.save(
        this.requestStatusHistoryRepo.create({
          requestId: saved.id,
          fromStatus: null,
          toStatus: RequestStatus.PENDING,
          changedBy: user.id,
          reason: 'Blood request created',
        }),
      );

      // 5. Enqueue for async processing
      await this.enqueue(saved);

      return {
        message: 'Blood request created successfully',
        data: saved,
      };
    } catch (error) {
      // Compensate: release any reserved inventory
      for (const r of reserved) {
        try {
          await this.inventoryService.releaseStock(
            r.bloodBankId,
            r.bloodType,
            r.quantity,
            r.component,
          );
        } catch (releaseError) {
          this.logger.error(
            `Failed to release reserved stock for ${r.bloodType} at ${r.bloodBankId}`,
            releaseError instanceof Error ? releaseError.stack : undefined,
          );
        }
      }

      if (error instanceof BloodRequestIrrecoverableError) {
        await this.compensationService.compensate({
          action: CompensationAction.RELEASE_INVENTORY,
          payload: { reserved },
        });
      }

      throw error;
    }
  }

  async findOne(id: string): Promise<BloodRequestEntity> {
    const request = await this.bloodRequestRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!request) {
      throw new BadRequestException(`Blood request ${id} not found`);
    }
    return request;
  }

  async findByHospital(hospitalId: string): Promise<BloodRequestEntity[]> {
    return this.bloodRequestRepo.find({
      where: { hospitalId },
      relations: ['items'],
      order: { createdAt: 'DESC' },
    });
  }

  async updateStatus(
    id: string,
    status: BloodRequestStatus,
    changedBy: string,
    reason?: string,
  ): Promise<BloodRequestEntity> {
    const request = await this.findOne(id);
    const fromStatus = request.status;
    request.status = status as unknown as RequestStatus;
    const saved = await this.bloodRequestRepo.save(request);

    await this.requestStatusHistoryRepo.save(
      this.requestStatusHistoryRepo.create({
        requestId: saved.id,
        fromStatus,
        toStatus: status as unknown as RequestStatus,
        changedBy,
        reason: reason ?? null,
      }),
    );

    return saved;
  }

  async getStatusHistory(id: string): Promise<RequestStatusHistoryEntity[]> {
    return this.requestStatusHistoryRepo.find({
      where: { requestId: id },
      order: { createdAt: 'ASC' },
    });
  }
}
