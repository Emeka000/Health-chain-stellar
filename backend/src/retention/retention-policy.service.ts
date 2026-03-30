import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';

import Redis from 'ioredis';
import { Repository, LessThan, DataSource } from 'typeorm';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { UserEntity } from '../users/entities/user.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { AuditLogService } from '../common/audit/audit-log.service';

export interface RetentionPolicyResult {
  usersAnonymised: number;
  ussdSessionsDeleted: number;
  orderPatientIdsStripped: number;
  dryRun: boolean;
}

/** First Sunday of each month at 02:00 UTC */
const FIRST_SUNDAY_CRON = '0 2 1-7 * 0';

const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class RetentionPolicyService {
  private readonly logger = new Logger(RetentionPolicyService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly auditLogService: AuditLogService,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(FIRST_SUNDAY_CRON, { name: 'retention-policy-job', timeZone: 'UTC' })
  async runScheduled(): Promise<void> {
    this.logger.log('Scheduled retention policy job starting');
    await this.run(false);
  }

  /**
   * Execute the retention policy.
   * @param dryRun - when true, reports what would change without mutating data.
   */
  async run(dryRun: boolean): Promise<RetentionPolicyResult> {
    this.logger.log(`Retention policy run started (dryRun=${dryRun})`);

    const [usersAnonymised, ussdSessionsDeleted, orderPatientIdsStripped] =
      await Promise.all([
        this.anonymiseInactiveUsers(dryRun),
        this.purgeOldUssdSessions(dryRun),
        this.stripOldOrderPatientIds(dryRun),
      ]);

    const result: RetentionPolicyResult = {
      usersAnonymised,
      ussdSessionsDeleted,
      orderPatientIdsStripped,
      dryRun,
    };

    this.logger.log(`Retention policy run complete: ${JSON.stringify(result)}`);

    if (!dryRun) {
      await this.auditLogService.insert({
        actorId: 'SYSTEM',
        actorRole: 'system',
        action: 'retention-policy.run',
        resourceType: 'RetentionPolicy',
        resourceId: 'scheduled',
        nextValue: result as unknown as Record<string, unknown>,
      });
    }

    return result;
  }

  // ── Anonymise users inactive for > 3 years ────────────────────────────

  private async anonymiseInactiveUsers(dryRun: boolean): Promise<number> {
    const cutoff = new Date(Date.now() - THREE_YEARS_MS);

    const candidates = await this.userRepo.find({
      where: {
        updatedAt: LessThan(cutoff),
        anonymised: false,
        isActive: false,
      },
    });

    if (dryRun) {
      this.logger.log(`[DRY RUN] Would anonymise ${candidates.length} inactive user(s)`);
      return candidates.length;
    }

    let count = 0;
    for (const user of candidates) {
      const hash = (value: string) =>
        createHash('sha256').update(value).digest('hex').slice(0, 32);

      await this.dataSource.transaction(async (manager) => {
        await manager.update(UserEntity, user.id, {
          email: `anon-${hash(user.email)}@redacted.invalid`,
          firstName: null,
          lastName: null,
          name: `[ANONYMISED]`,
          phoneNumber: null,
          passwordHash: undefined, // invalidate credentials
          isActive: false,
          anonymised: true,
        });
      });

      await this.auditLogService.insert({
        actorId: 'SYSTEM',
        actorRole: 'system',
        action: 'retention-policy.user-anonymised',
        resourceType: 'User',
        resourceId: user.id,
        previousValue: { email: user.email, anonymised: false },
        nextValue: { anonymised: true },
      });

      count++;
    }

    this.logger.log(`Anonymised ${count} inactive user(s)`);
    return count;
  }

  // ── Hard-delete USSD sessions older than 90 days ─────────────────────

  private async purgeOldUssdSessions(dryRun: boolean): Promise<number> {
    const cutoffMs = Date.now() - NINETY_DAYS_MS;
    let deleted = 0;

    const stream = this.redis.scanStream({ match: 'ussd:session:*', count: 100 });

    for await (const keys of stream) {
      for (const key of keys as string[]) {
        try {
          const raw = await this.redis.get(key);
          if (!raw) continue;

          const session = JSON.parse(raw) as { createdAt?: number };
          const createdAt = session.createdAt ?? 0;

          if (createdAt < cutoffMs) {
            if (!dryRun) {
              await this.redis.del(key);
            }
            deleted++;
          }
        } catch {
          // Malformed session — skip
        }
      }
    }

    if (dryRun) {
      this.logger.log(`[DRY RUN] Would delete ${deleted} USSD session(s)`);
    } else {
      this.logger.log(`Deleted ${deleted} stale USSD session(s)`);
      if (deleted > 0) {
        await this.auditLogService.insert({
          actorId: 'SYSTEM',
          actorRole: 'system',
          action: 'retention-policy.ussd-sessions-purged',
          resourceType: 'UssdSession',
          resourceId: 'bulk',
          nextValue: { deleted },
        });
      }
    }

    return deleted;
  }

  // ── Strip patientId from orders older than 10 years ──────────────────

  private async stripOldOrderPatientIds(dryRun: boolean): Promise<number> {
    const cutoff = new Date(Date.now() - TEN_YEARS_MS);

    const candidates = await this.orderRepo
      .createQueryBuilder('order')
      .where('order.createdAt < :cutoff', { cutoff })
      .andWhere('order.patientId IS NOT NULL')
      .getMany();

    if (dryRun) {
      this.logger.log(`[DRY RUN] Would strip patientId from ${candidates.length} order(s)`);
      return candidates.length;
    }

    if (candidates.length === 0) return 0;

    const ids = candidates.map((o) => o.id);
    await this.orderRepo
      .createQueryBuilder()
      .update()
      .set({ patientId: null })
      .whereInIds(ids)
      .execute();

    await this.auditLogService.insert({
      actorId: 'SYSTEM',
      actorRole: 'system',
      action: 'retention-policy.order-patient-ids-stripped',
      resourceType: 'Order',
      resourceId: 'bulk',
      nextValue: { count: candidates.length, orderIds: ids.slice(0, 20) },
    });

    this.logger.log(`Stripped patientId from ${candidates.length} order(s)`);
    return candidates.length;
  }
}
