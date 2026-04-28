import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { PaginatedResponse, PaginationQueryDto, PaginationUtil } from '../common/pagination';
import { BloodRequestReservationEntity, ReservationStatus } from '../blood-requests/entities/blood-request-reservation.entity';
import { ReservationAuditAction, ReservationAuditEntity } from './entities/reservation-audit.entity';
import { InventoryStockEntity } from './entities/inventory-stock.entity';
import { InventoryStockRepository } from './repositories/inventory-stock.repository';

export interface ReserveOptions {
  /** Urgency for priority tie-breaking: CRITICAL > URGENT > ROUTINE > SCHEDULED */
  urgency?: 'CRITICAL' | 'URGENT' | 'ROUTINE' | 'SCHEDULED';
  requestId?: string;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly stockRepo: InventoryStockRepository,
    @InjectRepository(ReservationAuditEntity)
    private readonly auditRepo: Repository<ReservationAuditEntity>,
    @InjectRepository(BloodRequestReservationEntity)
    private readonly reservationRepo: Repository<BloodRequestReservationEntity>,
  ) {}

  async findAll(
    hospitalId?: string,
    paginationDto?: PaginationQueryDto,
  ): Promise<PaginatedResponse<InventoryStockEntity>> {
    const { page = 1, pageSize = 25 } = paginationDto ?? {};
    const where = hospitalId
      ? ({ bloodBankId: hospitalId } as Partial<InventoryStockEntity>)
      : {};
    const [data, totalCount] = await this.stockRepo.findAndCount(
      where,
      PaginationUtil.calculateSkip(page, pageSize),
      pageSize,
    );
    return PaginationUtil.createResponse(data, page, pageSize, totalCount);
  }

  async findOne(id: string) {
    const item = await this.stockRepo.findById(id);
    if (!item) throw new NotFoundException(`Inventory item '${id}' not found`);
    return { message: 'Inventory item retrieved successfully', data: item };
  }

  async create(dto: any) {
    const existing = await this.stockRepo.findByBankAndType(dto.bloodBankId, dto.bloodType);
    const units = Number(dto.availableUnits ?? dto.availableUnitsMl ?? dto.quantity ?? 0);
    const entity = existing
      ? this.stockRepo.merge(existing, { availableUnitsMl: units })
      : this.stockRepo.create({ bloodBankId: dto.bloodBankId, bloodType: dto.bloodType, availableUnitsMl: units });
    const data = await this.stockRepo.save(entity);
    return { message: 'Inventory item created successfully', data };
  }

  async update(id: string, dto: any) {
    const existing = await this.stockRepo.findById(id);
    if (!existing) throw new NotFoundException(`Inventory item '${id}' not found`);
    const units =
      dto.availableUnits !== undefined
        ? Number(dto.availableUnits)
        : dto.availableUnitsMl !== undefined
          ? Number(dto.availableUnitsMl)
          : existing.availableUnitsMl;
    const updated = this.stockRepo.merge(existing, { ...dto, availableUnitsMl: units });
    const data = await this.stockRepo.save(updated);
    return { message: 'Inventory item updated successfully', data };
  }

  async remove(id: string) {
    const item = await this.stockRepo.findById(id);
    if (!item) throw new NotFoundException(`Inventory item '${id}' not found`);
    await this.stockRepo.remove(item);
    return { message: 'Inventory item deleted successfully', data: { id } };
  }

  async updateStock(id: string, quantity: number) {
    const existing = await this.stockRepo.findById(id);
    if (!existing) throw new NotFoundException(`Inventory item '${id}' not found`);
    existing.availableUnitsMl = Number(quantity);
    const data = await this.stockRepo.save(existing);
    return { message: 'Stock updated successfully', data };
  }

  async getLowStockItems(threshold = 10) {
    const data = await this.stockRepo.getLowStock(threshold);
    return { message: 'Low stock items retrieved successfully', data };
  }

  findByBankAndBloodType(
    bloodBankId: string,
    bloodType: string,
  ): Promise<InventoryStockEntity | null> {
    return this.stockRepo.findByBankAndType(bloodBankId, bloodType);
  }

  async reserveStockOrThrow(
    bloodBankId: string,
    bloodType: string,
    quantity: number,
    opts?: ReserveOptions,
  ): Promise<void> {
    if (quantity <= 0) {
      throw new ConflictException('Requested quantity must be greater than zero.');
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const stock = await this.stockRepo.findByBankAndType(bloodBankId, bloodType);
      if (!stock) {
        throw new ConflictException(
          `No inventory found for blood type ${bloodType} at blood bank ${bloodBankId}.`,
        );
      }
      if (stock.availableUnitsMl < quantity) {
        throw new ConflictException(
          `Insufficient stock for ${bloodType} at blood bank ${bloodBankId}. Available: ${stock.availableUnitsMl}, requested: ${quantity}.`,
        );
      }
      const result = await this.stockRepo.atomicDecrement(stock.id, stock.version, quantity);
      if (result.affected === 1) {
        if (opts?.requestId) {
          await this.writeAudit(opts.requestId, bloodBankId, bloodType, quantity, ReservationAuditAction.RESERVED, opts.urgency);
        }
        return;
      }
      if (attempt === 0) continue;
      throw new ConflictException('Inventory was updated by another order request. Please retry.');
    }
  }

  async restoreStockOrThrow(
    bloodBankId: string,
    bloodType: string,
    quantity: number,
  ): Promise<void> {
    if (quantity <= 0) {
      throw new ConflictException('Restore quantity must be greater than zero.');
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const stock = await this.stockRepo.findByBankAndType(bloodBankId, bloodType);
      if (!stock) {
        const created = this.stockRepo.create({ bloodBankId, bloodType, availableUnitsMl: quantity });
        await this.stockRepo.save(created);
        return;
      }
      const result = await this.stockRepo.atomicIncrement(stock.id, stock.version, quantity);
      if (result.affected === 1) return;
      if (attempt === 0) continue;
      throw new ConflictException('Inventory was updated by another request. Please retry restoring stock.');
    }
  }

  async commitFulfillmentStockOrThrow(
    bloodBankId: string,
    bloodType: string,
    _quantity: number,
  ): Promise<void> {
    const stock = await this.stockRepo.findByBankAndType(bloodBankId, bloodType);
    if (!stock) {
      throw new ConflictException(
        `No inventory found for blood type ${bloodType} at blood bank ${bloodBankId}.`,
      );
    }
    await this.stockRepo.bumpVersion(stock.id);
  }

  releaseStockByBankAndType(
    bloodBankId: string,
    bloodType: string,
    quantity: number,
  ): Promise<void> {
    return this.restoreStockOrThrow(bloodBankId, bloodType, quantity);
  }

  // ── Expiration auto-release ──────────────────────────────────────────

  /**
   * Scan for expired RESERVED reservations, release their stock, and write audit records.
   * Runs every minute. Each release uses optimistic locking to prevent double-release.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async releaseExpiredReservations(): Promise<void> {
    const nowTs = Math.floor(Date.now() / 1000);
    const expired = await this.reservationRepo.find({
      where: { status: ReservationStatus.RESERVED, expiresAt: LessThan(nowTs) },
      take: 100,
    });

    for (const res of expired) {
      try {
        // Mark expired first to prevent double-release
        const result = await this.reservationRepo
          .createQueryBuilder()
          .update(BloodRequestReservationEntity)
          .set({ status: ReservationStatus.EXPIRED })
          .where('id = :id', { id: res.id })
          .andWhere('status = :status', { status: ReservationStatus.RESERVED })
          .execute();

        if (!result.affected) continue; // already handled by another worker

        await this.restoreStockOrThrow(res.bloodBankId, res.bloodUnitId, res.quantityMl);

        await this.auditRepo.save(
          this.auditRepo.create({
            requestId: res.requestId,
            bloodBankId: res.bloodBankId,
            bloodType: res.bloodUnitId,
            quantityMl: res.quantityMl,
            action: ReservationAuditAction.EXPIRED_RELEASED,
            notes: `Reservation ${res.id} expired at ${res.expiresAt}`,
          }),
        );

        this.logger.log(`Released expired reservation ${res.id} requestId=${res.requestId}`);
      } catch (err) {
        this.logger.error(`Failed to release expired reservation ${res.id}`, err);
      }
    }
  }

  // ── Audit helpers ────────────────────────────────────────────────────

  private async writeAudit(
    requestId: string,
    bloodBankId: string,
    bloodType: string,
    quantityMl: number,
    action: ReservationAuditAction,
    urgency?: string,
    notes?: string,
  ): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({ requestId, bloodBankId, bloodType, quantityMl, action, urgency: urgency ?? null, notes: notes ?? null }),
    );
  }
}
