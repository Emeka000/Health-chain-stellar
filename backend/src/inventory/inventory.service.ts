import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import {
  PaginatedResponse,
  PaginationQueryDto,
  PaginationUtil,
} from '../common/pagination';
import {
  BloodRequestReservationEntity,
  ReservationStatus,
} from '../blood-requests/entities/blood-request-reservation.entity';
import {
  ReservationAuditAction,
  ReservationAuditEntity,
} from './entities/reservation-audit.entity';
import { InventoryStockEntity } from './entities/inventory-stock.entity';
import { InventoryRepository } from './repositories/inventory.repository';
import { InventoryStockRepository } from './repositories/inventory-stock.repository';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

import { BloodComponent } from '../blood-units/enums/blood-component.enum';

export interface ReserveOptions {
  /** Urgency for priority tie-breaking: CRITICAL > URGENT > ROUTINE > SCHEDULED */
  urgency?: 'CRITICAL' | 'URGENT' | 'ROUTINE' | 'SCHEDULED';
  requestId?: string;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(InventoryStockEntity)
    private readonly inventoryRepo: Repository<InventoryStockEntity>,
    private readonly customInventoryRepo: InventoryRepository,
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

  async findOne(id: string, bloodBankId: string) {
    const item = await this.stockRepo.findById(id, bloodBankId);
    if (!item) throw new NotFoundException(`Inventory item '${id}' not found`);
    return { message: 'Inventory item retrieved successfully', data: item };
  }

  async create(dto: CreateInventoryDto, bloodBankId: string) {
    if (!bloodBankId || dto.hospitalId !== bloodBankId) {
      throw new ForbiddenException(
        'You can only manage inventory for your organization.',
      );
    }
    const component = BloodComponent.WHOLE_BLOOD;
    const existing = await this.stockRepo.findByBankAndType(
      bloodBankId,
      dto.bloodType,
      component,
    );
    const units = Number(dto.quantity);
    const entity = existing
      ? this.stockRepo.merge(existing, { availableUnitsMl: units })
      : this.stockRepo.create({
          bloodBankId,
          bloodType: dto.bloodType,
          component,
          availableUnitsMl: units,
        });
    const data = await this.stockRepo.save(entity);
    return { message: 'Inventory item created successfully', data };
  }

  async update(id: string, dto: UpdateInventoryDto, bloodBankId: string) {
    const existing = await this.stockRepo.findById(id, bloodBankId);
    if (!existing)
      throw new NotFoundException(`Inventory item '${id}' not found`);
    const updated = this.stockRepo.merge(existing, {
      availableUnitsMl:
        dto.quantity !== undefined
          ? Number(dto.quantity)
          : existing.availableUnitsMl,
    });
    const data = await this.stockRepo.save(updated);
    return { message: 'Inventory item updated successfully', data };
  }

  async remove(id: string, bloodBankId: string) {
    const item = await this.stockRepo.findById(id, bloodBankId);
    if (!item) throw new NotFoundException(`Inventory item '${id}' not found`);
    await this.stockRepo.remove(item);
    return { message: 'Inventory item deleted successfully', data: { id } };
  }

  async updateStock(id: string, quantity: number, bloodBankId: string) {
    const existing = await this.stockRepo.findById(id, bloodBankId);
    if (!existing)
      throw new NotFoundException(`Inventory item '${id}' not found`);
    existing.availableUnitsMl = Number(quantity);
    const data = await this.stockRepo.save(existing);
    return { message: 'Stock updated successfully', data };
  }

  async getStockAggregation() {
    const data = await this.customInventoryRepo.getStockAggregationByBloodType();
    return { data };
  }

  async getLowStockItems(threshold = 10) {
    const data = await this.stockRepo.getLowStock(threshold);
    return { message: 'Low stock items retrieved successfully', data };
  }

  findByBankAndBloodType(
    bloodBankId: string,
    bloodType: string,
    component: BloodComponent | string = BloodComponent.WHOLE_BLOOD,
  ): Promise<InventoryStockEntity | null> {
    return this.stockRepo.findByBankAndType(bloodBankId, bloodType, component);
  }

  async reserveStockOrThrow(
    bloodBankId: string,
    bloodType: string,
    quantity: number,
    opts?: ReserveOptions,
    component: BloodComponent | string = BloodComponent.WHOLE_BLOOD,
  ): Promise<void> {
    if (quantity <= 0) {
      throw new ConflictException(
        'Requested quantity must be greater than zero.',
      );
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const stock = await this.stockRepo.findByBankAndType(
        bloodBankId,
        bloodType,
        component,
      );
      if (!stock) {
        throw new ConflictException(
          `No inventory found for blood type ${bloodType} (${component}) at blood bank ${bloodBankId}.`,
        );
      }
      if (stock.availableUnitsMl < quantity) {
        throw new ConflictException(
          `Insufficient stock for ${bloodType} (${component}) at blood bank ${bloodBankId}. Available: ${stock.availableUnitsMl}, requested: ${quantity}.`,
        );
      }
      const result = await this.stockRepo.atomicDecrement(
        stock.id,
        stock.version,
        quantity,
      );
      if (result.affected === 1) {
        if (opts?.requestId) {
          await this.writeAudit(
            opts.requestId,
            bloodBankId,
            bloodType,
            quantity,
            ReservationAuditAction.RESERVED,
            opts.urgency,
          );
        }
        return;
      }
      if (attempt === 0) continue;
      throw new ConflictException(
        'Inventory was updated by another order request. Please retry.',
      );
    }
  }

  async restoreStockOrThrow(
    bloodBankId: string,
    bloodType: string,
    quantity: number,
    component: BloodComponent | string = BloodComponent.WHOLE_BLOOD,
  ): Promise<void> {
    if (quantity <= 0) {
      throw new ConflictException(
        'Restore quantity must be greater than zero.',
      );
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const stock = await this.stockRepo.findByBankAndType(
        bloodBankId,
        bloodType,
        component,
      );
      if (!stock) {
        const created = this.stockRepo.create({
          bloodBankId,
          bloodType: bloodType as any,
          component: component as any,
          availableUnitsMl: quantity,
        });
        await this.stockRepo.save(created);
        return;
      }
      const result = await this.stockRepo.atomicIncrement(
        stock.id,
        stock.version,
        quantity,
      );
      if (result.affected === 1) return;
      if (attempt === 0) continue;
      throw new ConflictException(
        'Inventory was updated by another request. Please retry restoring stock.',
      );
    }
  }

  async commitFulfillmentStockOrThrow(
    bloodBankId: string,
    bloodType: string,
    _quantity: number,
    component: BloodComponent | string = BloodComponent.WHOLE_BLOOD,
  ): Promise<void> {
    const stock = await this.stockRepo.findByBankAndType(
      bloodBankId,
      bloodType,
      component,
    );
    if (!stock) {
      throw new ConflictException(
        `No inventory found for blood type ${bloodType} (${component}) at blood bank ${bloodBankId}.`,
      );
    }
    await this.stockRepo.bumpVersion(stock.id);
  }

  releaseStockByBankAndType(
    bloodBankId: string,
    bloodType: string,
    quantity: number,
    component: BloodComponent | string = BloodComponent.WHOLE_BLOOD,
  ): Promise<void> {
    return this.restoreStockOrThrow(bloodBankId, bloodType, quantity, component);
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
        await this.reservationRepo.manager.transaction(async (manager) => {
          // Mark expired first to prevent double-release
          const result = await manager
            .createQueryBuilder()
            .update(BloodRequestReservationEntity)
            .set({ status: ReservationStatus.EXPIRED })
            .where('id = :id', { id: res.id })
            .andWhere('status = :status', { status: ReservationStatus.RESERVED })
            .execute();

          if (!result.affected) return; // already handled by another worker

          // Restore stock
          const bloodType = (res as any).bloodType;
          const component = BloodComponent.WHOLE_BLOOD;
          let stock = await manager.findOne(InventoryStockEntity, {
            where: {
              bloodBankId: res.bloodBankId,
              bloodType: bloodType,
              component: component as any,
            },
          });

          if (!stock) {
            const created = manager.create(InventoryStockEntity, {
              bloodBankId: res.bloodBankId,
              bloodType: bloodType,
              component: component as any,
              availableUnitsMl: res.quantityMl,
            });
            await manager.save(created);
          } else {
            await manager
              .createQueryBuilder()
              .update(InventoryStockEntity)
              .set({
                availableUnitsMl: () => `"available_units_ml" + ${res.quantityMl}`,
                version: () => '"version" + 1',
              })
              .where('id = :id', { id: stock.id })
              .execute();
          }

          await manager.save(
            manager.create(ReservationAuditEntity, {
              requestId: res.requestId,
              bloodBankId: res.bloodBankId,
              bloodType: bloodType,
              quantityMl: res.quantityMl,
              action: ReservationAuditAction.EXPIRED_RELEASED,
              notes: `Reservation ${res.id} expired at ${res.expiresAt}`,
            }),
          );
        });

        this.logger.log(
          `Released expired reservation ${res.id} requestId=${res.requestId}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to release expired reservation ${res.id}`,
          err,
        );
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
      this.auditRepo.create({
        requestId,
        bloodBankId,
        bloodType,
        quantityMl,
        action,
        urgency: urgency ?? null,
        notes: notes ?? null,
      }),
    );
  }
}
