import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { ReadinessDependencyEntity } from './entities/readiness-dependency.entity';
import {
  ReadinessChecklistStatus,
  ReadinessEntityType,
  ReadinessItemKey,
  ReadinessItemStatus,
} from './enums/readiness.enum';
import { ReadinessGraphService } from './services/readiness-graph.service';

/** All item keys that must be COMPLETE or WAIVED before sign-off */
const ALL_ITEM_KEYS = Object.values(ReadinessItemKey);

@Injectable()
export class ReadinessService {
  constructor(
    @InjectRepository(ReadinessChecklistEntity)
    private readonly checklistRepo: Repository<ReadinessChecklistEntity>,
    @InjectRepository(ReadinessItemEntity)
    private readonly itemRepo: Repository<ReadinessItemEntity>,
    @InjectRepository(ReadinessDependencyEntity)
    private readonly dependencyRepo: Repository<ReadinessDependencyEntity>,
    private readonly graphService: ReadinessGraphService,
    private readonly eventEmitter: EventEmitter2,
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

    if (dto.status === ReadinessItemStatus.COMPLETE) {
      const blockers = this.graphService.getBlockers(itemKey, checklist.items, {
        entityType: checklist.entityType,
      });
      if (blockers.length > 0) {
        throw new BadRequestException(
          `Cannot complete item '${itemKey}' because it is blocked: ${blockers
            .map((b) => b.reason)
            .join(', ')}`,
        );
      }
    }

    if (dto.status !== ReadinessItemStatus.PENDING) {
      item.completedAt = new Date();
      item.completedBy = userId;
    } else {
      item.completedAt = null;
      item.completedBy = null;
    }
    await this.itemRepo.save(item);

    // Recompute checklist status
    const updatedChecklist = await this.recomputeStatus(checklist);

    // Emit event for downstream workflows
    this.eventEmitter.emit('readiness.item_updated', {
      checklistId: updatedChecklist.id,
      itemKey,
      status: dto.status,
      entityType: updatedChecklist.entityType,
      entityId: updatedChecklist.entityId,
    });

    return updatedChecklist;
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

  /**
   * Updates the global dependency configuration.
   * Rejects if cycles are detected.
   */
  async updateDependencies(
    proposed: Array<{
      parentItemKey: ReadinessItemKey;
      dependsOnItemKey: ReadinessItemKey;
    }>,
  ) {
    this.graphService.validateProposedDependencies(proposed);

    await this.dependencyRepo.clear();
    const entities = proposed.map((p) => this.dependencyRepo.create(p));
    await this.dependencyRepo.save(entities);

    await this.graphService.refreshGraph();
  }

  /**
   * Generates a comprehensive report including dependency blocking details.
   */
  async getReadinessReport(checklistId: string) {
    const checklist = await this.getChecklist(checklistId);
    const report = checklist.items.map((item) => {
      const blockers = this.graphService.getBlockers(
        item.itemKey,
        checklist.items,
        { entityType: checklist.entityType },
      );
      return {
        ...item,
        isBlocked: blockers.length > 0,
        blockingReasons: blockers.map((b) => b.reason),
        prerequisites: this.graphService.getPrerequisites(item.itemKey),
      };
    });

    return {
      checklistId: checklist.id,
      status: checklist.status,
      entityType: checklist.entityType,
      entityId: checklist.entityId,
      items: report,
    };
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
