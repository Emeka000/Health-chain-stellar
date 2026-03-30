import { randomBytes } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { UserRole } from '../auth/enums/user-role.enum';
import { PermissionsService } from '../auth/permissions.service';
import { BloodRequestIrrecoverableError } from '../common/errors/app-errors';
import { InventoryService } from '../inventory/inventory.service';

import { CreateBloodRequestDto } from './dto/create-blood-request.dto';
import { BloodRequestItemEntity } from './entities/blood-request-item.entity';
import { BloodRequestEntity } from './entities/blood-request.entity';
import { BloodRequestStatus } from './enums/blood-request-status.enum';
import {
  BLOOD_REQUEST_QUEUE,
  QUEUE_PRIORITY,
  RequestUrgency,
} from './enums/request-urgency.enum';
import { BloodRequestJobData } from './processors/blood-request.processor';
import { BloodRequestChainService } from './services/blood-request-chain.service';
import { BloodRequestEmailService } from './services/blood-request-email.service';

type RequestUser = { id: string; role: string; email: string };

@Injectable()
export class BloodRequestsService {
  constructor(
    @InjectRepository(BloodRequestEntity)
    private readonly bloodRequestRepo: Repository<BloodRequestEntity>,
    @InjectRepository(BloodRequestItemEntity)
    private readonly itemRepo: Repository<BloodRequestItemEntity>,
    private readonly inventoryService: InventoryService,
    private readonly chainService: BloodRequestChainService,
    private readonly emailService: BloodRequestEmailService,
    private readonly permissionsService: PermissionsService,
    @InjectQueue(BLOOD_REQUEST_QUEUE)
    private readonly queue: Queue<BloodRequestJobData>,
  ) {}

  async create(
    dto: CreateBloodRequestDto,
    user: RequestUser,
  ): Promise<{ message: string; data: BloodRequestEntity }> {
    this.assertHospitalAuth(user, dto.hospitalId);
    const requiredBy = this.parseRequiredBy(dto.requiredBy);
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

      const transactionHash = await this.chainService.submitToChain(
        requestNumber,
        dto.hospitalId,
        reserved,
        user.email,
      );

      const saved = await this.persistRequest(dto, requestNumber, requiredBy, transactionHash, user.id);
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

  private assertHospitalAuth(user: RequestUser, hospitalId: string): void {
    if (user.role === UserRole.HOSPITAL) {
      this.permissionsService.assertIsAdminOrSelf(
        user,
        hospitalId,
        'Hospital accounts may only create blood requests where hospitalId matches their user id.',
      );
    }
  }

  private parseRequiredBy(iso: string): Date {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('requiredBy must be a valid ISO 8601 date-time');
    }
    if (d.getTime() <= Date.now()) {
      throw new BadRequestException('requiredBy must be in the future');
    }
    return d;
  }

  private async allocateRequestNumber(): Promise<string> {
    for (let i = 0; i < 12; i++) {
      const suffix = randomBytes(3).toString('hex').toUpperCase();
      const requestNumber = `BR-${Date.now()}-${suffix}`;
      const exists = await this.bloodRequestRepo.exist({ where: { requestNumber } });
      if (!exists) return requestNumber;
    }
    throw new Error('Unable to allocate a unique request number');
  }

  private async persistRequest(
    dto: CreateBloodRequestDto,
    requestNumber: string,
    requiredBy: Date,
    transactionHash: string,
    userId: string,
  ): Promise<BloodRequestEntity> {
    const parent = this.bloodRequestRepo.create({
      requestNumber,
      hospitalId: dto.hospitalId,
      requiredByTimestamp: Math.floor(requiredBy.getTime() / 1000),
      createdTimestamp: Math.floor(Date.now() / 1000),
      urgency: dto.urgency || 'ROUTINE',
      deliveryAddress: dto.deliveryAddress?.trim() ?? null,
      notes: dto.notes?.trim() ?? null,
      status: BloodRequestStatus.PENDING,
      blockchainTxHash: transactionHash,
      createdByUserId: userId,
      items: dto.items.map((i) =>
        this.itemRepo.create({
          bloodType: i.bloodType.trim(),
          component: i.component,
          quantityMl: i.quantityMl || i.quantity,
          priority: i.priority || 'NORMAL',
          compatibilityNotes: i.compatibilityNotes,
        }),
      ),
    });
    return this.bloodRequestRepo.save(parent);
  }

  private async enqueue(saved: BloodRequestEntity): Promise<void> {
    const urgency = (saved.urgency as unknown as RequestUrgency) ?? RequestUrgency.ROUTINE;
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
}
