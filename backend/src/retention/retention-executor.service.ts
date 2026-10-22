import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

import { AuditLogService } from '../common/audit/audit-log.service';
import { LegalHoldEntity, LegalHoldStatus } from './entities/legal-hold.entity';
import { RetentionPolicyEntity, DataCategory, RetentionAction } from './entities/retention-policy.entity';
import { DataRedactionEntity, RedactionStatus } from './entities/data-redaction.entity';
import { UserEntity } from '../users/entities/user.entity';
import { OrderEntity } from '../orders/entities/order.entity';

export interface RetentionExecutorResult {
  dryRun: boolean;
  processed: number;
  skippedDueToLegalHold: number;
  failed: number;
  orphanCheckPassed: boolean;
  complianceReport: ComplianceReportEntry[];
}

export interface ComplianceReportEntry {
  entityType: string;
  entityId: string;
  action: RetentionAction | 'skipped_legal_hold';
  reason: string;
  actorId: string;
  timestamp: string;
}

/** Retention policy matrix: maps entity types to their data categories */
const ENTITY_CATEGORY_MAP: Record<string, DataCategory> = {
  user: DataCategory.DONOR_DATA,
  rider: DataCategory.RIDER_DATA,
  organization: DataCategory.ORGANIZATION_DATA,
  order: DataCategory.DELIVERY_EVIDENCE,
  location_history: DataCategory.LOCATION_HISTORY,
  blood_unit: DataCategory.MEDICAL_RECORDS,
};

@Injectable()
export class RetentionExecutorService {
  private readonly logger = new Logger(RetentionExecutorService.name);

  constructor(
    @InjectRepository(LegalHoldEntity)
    private readonly legalHoldRepo: Repository<LegalHoldEntity>,
    @InjectRepository(RetentionPolicyEntity)
    private readonly policyRepo: Repository<RetentionPolicyEntity>,
    @InjectRepository(DataRedactionEntity)
    private readonly redactionRepo: Repository<DataRedactionEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly auditLogService: AuditLogService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Execute retention policies across all entity types.
   * Legal holds take precedence and block any action.
   * @param dryRun - when true, reports what would happen without mutating data.
   * @param actorId - identity of the actor triggering the run.
   */
  async execute(dryRun: boolean, actorId: string): Promise<RetentionExecutorResult> {
    this.logger.log(`Retention executor started (dryRun=${dryRun}, actor=${actorId})`);

    const policies = await this.policyRepo.find({ where: { isActive: true } });
    const activeLegalHolds = await this.legalHoldRepo.find({ where: { status: LegalHoldStatus.ACTIVE } });
    const holdIndex = this.buildHoldIndex(activeLegalHolds);

    const report: ComplianceReportEntry[] = [];
    let processed = 0;
    let skippedDueToLegalHold = 0;
    let failed = 0;

    for (const policy of policies) {
      try {
        const result = await this.applyPolicy(policy, holdIndex, dryRun, actorId, report);
        processed += result.processed;
        skippedDueToLegalHold += result.skipped;
        failed += result.failed;
      } catch (err) {
        this.logger.error(`Policy ${policy.id} (${policy.dataCategory}) failed: ${(err as Error).message}`);
        failed++;
      }
    }

    // Integrity check: ensure no orphaned foreign references
    const orphanCheckPassed = await this.checkOrphanedReferences(dryRun);

    if (!dryRun) {
      await this.auditLogService.insert({
        actorId,
        actorRole: 'system',
        action: 'retention-executor.run',
        resourceType: 'RetentionPolicy',
        resourceId: 'bulk',
        nextValue: { processed, skippedDueToLegalHold, failed, orphanCheckPassed } as unknown as Record<string, unknown>,
      });
    }

    this.logger.log(
      `Retention executor complete: processed=${processed} skipped=${skippedDueToLegalHold} failed=${failed} orphanCheck=${orphanCheckPassed}`,
    );

    return { dryRun, processed, skippedDueToLegalHold, failed, orphanCheckPassed, complianceReport: report };
  }

  // ── Legal hold management ────────────────────────────────────────────────

  async placeLegalHold(
    entityType: string,
    entityId: string,
    reason: string,
    placedBy: string,
  ): Promise<LegalHoldEntity> {
    const existing = await this.legalHoldRepo.findOne({
      where: { entityType, entityId, status: LegalHoldStatus.ACTIVE },
    });
    if (existing) {
      throw new BadRequestException(`Active legal hold already exists for ${entityType}:${entityId}`);
    }
    const hold = this.legalHoldRepo.create({ entityType, entityId, reason, placedBy });
    return this.legalHoldRepo.save(hold);
  }

  async releaseLegalHold(holdId: string, releasedBy: string): Promise<LegalHoldEntity> {
    const hold = await this.legalHoldRepo.findOne({ where: { id: holdId } });
    if (!hold) throw new NotFoundException(`Legal hold ${holdId} not found`);
    if (hold.status === LegalHoldStatus.RELEASED) {
      throw new BadRequestException('Legal hold is already released');
    }
    hold.status = LegalHoldStatus.RELEASED;
    hold.releasedBy = releasedBy;
    hold.releasedAt = new Date();
    return this.legalHoldRepo.save(hold);
  }

  async listLegalHolds(entityType?: string, entityId?: string): Promise<LegalHoldEntity[]> {
    const qb = this.legalHoldRepo.createQueryBuilder('h').orderBy('h.created_at', 'DESC');
    if (entityType) qb.andWhere('h.entity_type = :entityType', { entityType });
    if (entityId) qb.andWhere('h.entity_id = :entityId', { entityId });
    return qb.getMany();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private buildHoldIndex(holds: LegalHoldEntity[]): Set<string> {
    return new Set(holds.map((h) => `${h.entityType}:${h.entityId}`));
  }

  private async applyPolicy(
    policy: RetentionPolicyEntity,
    holdIndex: Set<string>,
    dryRun: boolean,
    actorId: string,
    report: ComplianceReportEntry[],
  ): Promise<{ processed: number; skipped: number; failed: number }> {
    const cutoff = new Date(Date.now() - policy.retentionPeriodDays * 24 * 60 * 60 * 1000);
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    // Apply to users (donor data)
    if (policy.dataCategory === DataCategory.DONOR_DATA) {
      const candidates = await this.userRepo
        .createQueryBuilder('u')
        .where('u.updated_at < :cutoff', { cutoff })
        .andWhere('u.is_active = false')
        .andWhere('u.anonymised = false')
        .getMany();

      for (const user of candidates) {
        const holdKey = `user:${user.id}`;
        if (holdIndex.has(holdKey)) {
          skipped++;
          report.push({ entityType: 'user', entityId: user.id, action: 'skipped_legal_hold', reason: 'Active legal hold', actorId, timestamp: new Date().toISOString() });
          continue;
        }

        try {
          if (!dryRun) {
            await this.dataSource.transaction(async (manager) => {
              await manager.update(UserEntity, user.id, {
                email: `anon-${user.id.slice(0, 8)}@redacted.invalid`,
                firstName: null,
                lastName: null,
                phoneNumber: null,
                anonymised: true,
              });
            });
          }
          processed++;
          report.push({ entityType: 'user', entityId: user.id, action: policy.retentionAction, reason: `Inactive > ${policy.retentionPeriodDays} days`, actorId, timestamp: new Date().toISOString() });
        } catch (err) {
          failed++;
          this.logger.error(`Failed to apply retention to user ${user.id}: ${(err as Error).message}`);
        }
      }
    }

    // Apply to orders (delivery evidence — strip patientId)
    if (policy.dataCategory === DataCategory.DELIVERY_EVIDENCE) {
      const candidates = await this.orderRepo
        .createQueryBuilder('o')
        .where('o.created_at < :cutoff', { cutoff })
        .andWhere('o.patient_id IS NOT NULL')
        .getMany();

      for (const order of candidates) {
        const holdKey = `order:${order.id}`;
        if (holdIndex.has(holdKey)) {
          skipped++;
          report.push({ entityType: 'order', entityId: order.id, action: 'skipped_legal_hold', reason: 'Active legal hold', actorId, timestamp: new Date().toISOString() });
          continue;
        }

        try {
          if (!dryRun) {
            await this.orderRepo.update(order.id, { patientId: null });
          }
          processed++;
          report.push({ entityType: 'order', entityId: order.id, action: policy.retentionAction, reason: `Order older than ${policy.retentionPeriodDays} days`, actorId, timestamp: new Date().toISOString() });
        } catch (err) {
          failed++;
        }
      }
    }

    return { processed, skipped, failed };
  }

  /**
   * Integrity check: verify no orphaned foreign references remain after retention.
   * Returns true if no orphans found.
   */
  private async checkOrphanedReferences(dryRun: boolean): Promise<boolean> {
    // Check for data_redactions referencing non-existent entities
    const orphanedRedactions = await this.redactionRepo
      .createQueryBuilder('r')
      .where('r.status = :status', { status: RedactionStatus.COMPLETED })
      .andWhere('r.entity_type = :type', { type: 'user' })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM users u WHERE u.id::text = r.entity_id)',
      )
      .getCount();

    if (orphanedRedactions > 0) {
      this.logger.warn(`Found ${orphanedRedactions} orphaned redaction records`);
      return false;
    }

    return true;
  }
}
