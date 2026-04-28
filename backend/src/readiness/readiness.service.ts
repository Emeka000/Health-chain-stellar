import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  CreateChecklistDto,
  QueryReadinessDto,
  SignOffDto,
  UpdateReadinessItemDto,
} from './dto/readiness.dto';
import { ReadinessChecklistEntity } from './entities/readiness-checklist.entity';
import { ReadinessItemEntity } from './entities/readiness-item.entity';
import {
  ReadinessChecklistStatus,
  ReadinessEntityType,
  ReadinessItemKey,
  ReadinessItemStatus,
} from './enums/readiness.enum';

/** All item keys that must be COMPLETE or WAIVED before sign-off */
const ALL_ITEM_KEYS = Object.values(ReadinessItemKey);

@Injectable()
export class ReadinessService {
  constructor(
    @InjectRepository(ReadinessChecklistEntity)
    private readonly checklistRepo: Repository<ReadinessChecklistEntity>,
    @InjectRepository(ReadinessItemEntity)
    private readonly itemRepo: Repository<ReadinessItemEntity>,
  ) {}

  // ── Checklist lifecycle ──────────────────────────────────────────────

  async createChecklist(
    dto: CreateChecklistDto,
  ): Promise<ReadinessChecklistEntity> {
    const existing = await this.checklistRepo.findOne({
      where: { entityType: dto.entityType, entityId: dto.entityId },
    });
    if (existing)
      throw new ConflictException(
        'Readiness checklist already exists for this entity',
      );

    const checklist = this.checklistRepo.create({
      entityType: dto.entityType,
      entityId: dto.entityId,
      status: ReadinessChecklistStatus.INCOMPLETE,
      signedOffBy: null,
      signedOffAt: null,
      reviewerNotes: null,
    });
    const saved = await this.checklistRepo.save(checklist);

    // Seed all items as PENDING
    const items = ALL_ITEM_KEYS.map((key) =>
      this.itemRepo.create({
        checklistId: saved.id,
        itemKey: key,
        status: ReadinessItemStatus.PENDING,
        evidenceUrl: null,
        notes: null,
        completedAt: null,
        completedBy: null,
      }),
    );
    await this.itemRepo.save(items);

    return this.getChecklist(saved.id);
  }

  async getChecklist(id: string): Promise<ReadinessChecklistEntity> {
    const c = await this.checklistRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!c) throw new NotFoundException(`Readiness checklist ${id} not found`);
    return c;
  }

  async getChecklistByEntity(
    entityType: ReadinessEntityType,
    entityId: string,
  ): Promise<ReadinessChecklistEntity | null> {
    return this.checklistRepo.findOne({
      where: { entityType, entityId },
      relations: ['items'],
    });
  }

  async listChecklists(
    query: QueryReadinessDto,
  ): Promise<ReadinessChecklistEntity[]> {
    const qb = this.checklistRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.items', 'items')
      .orderBy('c.created_at', 'DESC');

    if (query.entityType)
      qb.andWhere('c.entity_type = :et', { et: query.entityType });

    return qb.getMany();
  }

  /** Returns checklists that have at least one PENDING item (overdue / blocked) */
  async listBlocked(): Promise<ReadinessChecklistEntity[]> {
    return this.checklistRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.items', 'items')
      .where('c.status != :signed', {
        signed: ReadinessChecklistStatus.SIGNED_OFF,
      })
      .andWhere((qb) => {
        const sub = qb
          .subQuery()
          .select('1')
          .from(ReadinessItemEntity, 'i')
          .where('i.checklist_id = c.id')
          .andWhere('i.status = :pending', {
            pending: ReadinessItemStatus.PENDING,
          })
          .getQuery();
        return `EXISTS ${sub}`;
      })
      .orderBy('c.created_at', 'ASC')
      .getMany();
  }

  // ── Item updates ─────────────────────────────────────────────────────

  async updateItem(
    checklistId: string,
    itemKey: ReadinessItemKey,
    userId: string,
    dto: UpdateReadinessItemDto,
  ): Promise<ReadinessChecklistEntity> {
    const checklist = await this.getChecklist(checklistId);
    if (checklist.status === ReadinessChecklistStatus.SIGNED_OFF) {
      throw new BadRequestException('Cannot modify a signed-off checklist');
    }

    const item = checklist.items.find((i) => i.itemKey === itemKey);
    if (!item)
      throw new NotFoundException(`Item ${itemKey} not found in checklist`);

    item.status = dto.status;
    item.evidenceUrl = dto.evidenceUrl ?? item.evidenceUrl;
    item.notes = dto.notes ?? item.notes;
    if (dto.status !== ReadinessItemStatus.PENDING) {
      item.completedAt = new Date();
      item.completedBy = userId;
    } else {
      item.completedAt = null;
      item.completedBy = null;
    }
    await this.itemRepo.save(item);

    // Recompute checklist status
    return this.recomputeStatus(checklist);
  }

  // ── Sign-off ─────────────────────────────────────────────────────────

  async signOff(
    checklistId: string,
    userId: string,
    dto: SignOffDto,
  ): Promise<ReadinessChecklistEntity> {
    const checklist = await this.getChecklist(checklistId);

    const hasPending = checklist.items.some(
      (i) => i.status === ReadinessItemStatus.PENDING,
    );
    if (hasPending) {
      throw new BadRequestException(
        'All checklist items must be complete or waived before sign-off',
      );
    }

    checklist.status = ReadinessChecklistStatus.SIGNED_OFF;
    checklist.signedOffBy = userId;
    checklist.signedOffAt = new Date();
    checklist.reviewerNotes = dto.reviewerNotes ?? null;
    return this.checklistRepo.save(checklist);
  }

  // ── Readiness gate ───────────────────────────────────────────────────

  /**
   * Returns true only if the entity has a SIGNED_OFF checklist.
   * Used by activation workflows to block incomplete partners.
   */
  async isReady(
    entityType: ReadinessEntityType,
    entityId: string,
  ): Promise<boolean> {
    const checklist = await this.checklistRepo.findOne({
      where: {
        entityType,
        entityId,
        status: ReadinessChecklistStatus.SIGNED_OFF,
      },
    });
    return checklist !== null;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private async recomputeStatus(
    checklist: ReadinessChecklistEntity,
  ): Promise<ReadinessChecklistEntity> {
    const items = await this.itemRepo.find({
      where: { checklistId: checklist.id },
    });
    const allDone = items.every(
      (i) => i.status !== ReadinessItemStatus.PENDING,
    );
    checklist.status = allDone
      ? ReadinessChecklistStatus.READY
      : ReadinessChecklistStatus.INCOMPLETE;
    return this.checklistRepo.save(checklist);
  }
}
