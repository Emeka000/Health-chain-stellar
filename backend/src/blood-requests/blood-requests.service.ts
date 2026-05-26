import { randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { UserRole } from '../auth/enums/user-role.enum';
import { PermissionsService } from '../auth/permissions.service';
import { BloodRequestIrrecoverableError } from '../common/errors/app-errors';
import { InventoryService } from '../inventory/inventory.service';

import { CreateBloodRequestDto } from './dto/create-blood-request.dto';
import {
  BloodRequestItemEntity,
  ItemPriority,
} from './entities/blood-request-item.entity';
import { BloodRequestEntity, RequestUrgency } from './entities/blood-request.entity';
import { RequestStatusHistoryEntity } from './entities/request-status-history.entity';
import { BloodRequestStatus, RequestStatus } from './enums/blood-request-status.enum';
import { TriageScoringService } from './services/triage-scoring.service';
import {
  BLOOD_REQUEST_QUEUE,
  QUEUE_PRIORITY,
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
    private readonly chainService: BloodRequestChainService,
    private readonly emailService: BloodRequestEmailService,
    private readonly permissionsService: PermissionsService,
    private readonly triageScoringService: TriageScoringService,
    @InjectQueue(BLOOD_REQUEST_QUEUE)
    private readonly queue: Queue<BloodRequestJobData>,
  ) {}

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
      if (!exists) {
        return requestNumber;
      }
    }
    throw new Error('Unable to allocate a unique request number');
  }

  private async releaseReservations(
    reserved: Array<{
      bloodBankId: string;
      bloodType: string;
      quantity: number;
    }>,
  ): Promise<void> {
    for (const r of reserved.reverse()) {
      await this.inventoryService.releaseStockByBankAndType(
        r.bloodBankId,
        r.bloodType,
        r.quantity,
      );
    }
  }

  private calculateSlaResponseDueAt(urgencyLevel: RequestUrgency): Date {
    const now = new Date();
    const urgencyToHours: Record<RequestUrgency, number> = {
      [RequestUrgency.CRITICAL]: 1,
      [RequestUrgency.URGENT]: 4,
      [RequestUrgency.ROUTINE]: 24,
      [RequestUrgency.SCHEDULED]: 72,
    };
    const deadline = new Date(now);
    deadline.setHours(deadline.getHours() + urgencyToHours[urgencyLevel]);
    return deadline;
  }

  async create(
    dto: CreateBloodRequestDto,
    user: RequestUser,
  ): Promise<{ message: string; data: BloodRequestEntity }> {
    this.assertHospitalAuthorization(user, dto.hospitalId);
    const requiredBy = this.assertRequiredByFuture(dto.requiredBy);
    const urgencyLevel = (dto.urgencyLevel ?? RequestUrgency.ROUTINE) as unknown as RequestUrgency;
    const slaResponseDueAt = this.calculateSlaResponseDueAt(urgencyLevel);

    const requestNumber = await this.allocateRequestNumber();

    const reserved: Array<{ bloodBankId: string; bloodType: string; quantity: number }> = [];

    try {
      for (const item of dto.items) {
        const bloodType = item.bloodType.trim();
        const quantity = item.quantityMl ?? item.quantity;
        const bloodBankId = item.bloodBankId || dto.hospitalId;
        if (!quantity) {
          throw new BadRequestException('Item quantity must be specified as quantityMl or quantity');
        }
        await this.inventoryService.reserveStockOrThrow(bloodBankId, bloodType, quantity);
        reserved.push({ bloodBankId, bloodType, quantity });
      }

      const chainPayload = dto.items.map((i) => ({
        bloodBankId: i.bloodBankId || dto.hospitalId,
        bloodType: i.bloodType.trim(),
        quantity: i.quantityMl ?? i.quantity,
      }));

      let transactionHash: string;
      transactionHash = await this.chainService.submitToChain(
        requestNumber,
        dto.hospitalId,
        reserved,
        user.email,
      );

      // Compute triage inputs from dto.items
      const highestPriority = dto.items.reduce<string>((best, item) => {
        const rank: Record<string, number> = { CRITICAL: 4, HIGH: 3, NORMAL: 2, LOW: 1 };
        return (rank[item.priority ?? 'NORMAL'] ?? 0) > (rank[best] ?? 0) ? (item.priority ?? 'NORMAL') : best;
      }, 'NORMAL');
      const totalRequestedUnits = dto.items.reduce((sum, i) => sum + (i.quantityMl ?? i.quantity ?? 0), 0);
      const totalAvailableUnits = totalRequestedUnits; // optimistic default

      const triage = this.triageScoringService.compute({
        urgency: dto.urgency ?? RequestUrgency.ROUTINE,
        itemPriority: highestPriority as ItemPriority,
        requestedUnits: totalRequestedUnits,
        availableUnits: totalAvailableUnits,
        requiredByTimestamp: Math.floor(requiredBy.getTime() / 1000),
        currentTimestamp: Math.floor(Date.now() / 1000),
      });

      const saved = await this.persistRequest(dto, requestNumber, requiredBy, transactionHash, user.id, slaResponseDueAt, triage.score);
      await this.enqueue(saved);
      await this.emailService.sendCreationConfirmation(user.email, saved);

      return { message: 'Blood request created successfully', data: saved };
    } catch (err) {
      if (!(err instanceof BloodRequestIrrecoverableError)) {
        for (const r of reserved.reverse()) {
          await this.inventoryService.releaseStockByBankAndType(r.bloodBankId, r.bloodType, r.quantity);
        }
      }
      throw err;
    }
  }

  private async persistRequest(
    dto: CreateBloodRequestDto,
    requestNumber: string,
    requiredBy: Date,
    transactionHash: string,
    userId: string,
    slaResponseDueAt: Date,
    triageScore: number,
  ): Promise<BloodRequestEntity> {
    const parent = this.bloodRequestRepo.create({
      requestNumber,
      hospitalId: dto.hospitalId,
      requiredByTimestamp: Math.floor(requiredBy.getTime() / 1000),
      createdTimestamp: Math.floor(Date.now() / 1000),
      urgency: (dto.urgency ?? RequestUrgency.ROUTINE) as RequestUrgency,
      deliveryAddress: dto.deliveryAddress?.trim() ?? null,
      notes: dto.notes?.trim() ?? null,
      status: RequestStatus.PENDING,
      slaResponseDueAt,
      slaFulfillmentDueAt: requiredBy,
      blockchainTxHash: transactionHash,
      blockchainRequestId: requestNumber,
      blockchainNetwork: 'stellar',
      createdByUserId: userId,
      triageScore,
      items: dto.items.map((i) =>
        this.bloodRequestItemRepo.create({
          bloodType: i.bloodType.trim(),
          component: i.component,
          quantityMl: i.quantityMl || i.quantity,
          priority: i.priority || 'NORMAL',
          compatibilityNotes: i.compatibilityNotes,
        } as any),
      ),
      statusHistory: [
        this.requestStatusHistoryRepo.create({
          previousStatus: null,
          newStatus: RequestStatus.PENDING,
          reason: 'Request created',
          changedByUserId: userId,
        }),
      ],
    } as any);
    return this.bloodRequestRepo.save(parent) as Promise<BloodRequestEntity>;
  }

  private async enqueue(saved: BloodRequestEntity): Promise<void> {
    const urgency = (saved.urgency as unknown as RequestUrgency) ?? RequestUrgency.ROUTINE;
    await this.queue.add(
      'process-request',
      { requestId: saved.id, urgency, enqueuedAt: Date.now() },
      {
        priority: QUEUE_PRIORITY[urgency] ?? 10,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
