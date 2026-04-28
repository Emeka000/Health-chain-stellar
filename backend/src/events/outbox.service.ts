import { createHash, randomUUID } from 'crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';

import {
  DeadLetterStatus,
  OutboxDeadLetterEntity,
} from './outbox-dead-letter.entity';
import {
  OutboxEventEntity,
  OutboxEventStatus,
  OutboxEventType,
} from './outbox-event.entity';

export interface PublishEventOptions {
  aggregateId?: string;
  aggregateType?: string;
  correlationId?: string;
  eventVersion?: number;
  /** Custom dedup key — defaults to SHA-256(aggregateId+eventType+correlationId) */
  dedupKey?: string;
}

const MAX_ATTEMPTS = 5;
const LEASE_TTL_MS = 30_000; // 30 s
const BASE_BACKOFF_MS = 2_000;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly outboxRepo: Repository<OutboxEventEntity>,
    @InjectRepository(OutboxDeadLetterEntity)
    private readonly deadLetterRepo: Repository<OutboxDeadLetterEntity>,
  ) {}

  // ── Transactional write path ─────────────────────────────────────────

  /**
   * Insert an outbox entry in the same DB transaction as the caller's entity write.
   * Pass the EntityManager from the caller's transaction to guarantee atomicity.
   *
   * @example
   * await this.dataSource.transaction(async (em) => {
   *   await em.save(BloodRequestEntity, request);
   *   await outboxService.publishInTransaction(em, 'BLOOD_REQUEST_CREATED', payload, { aggregateId: request.id });
   * });
   */
  async publishInTransaction(
    em: EntityManager,
    eventType: OutboxEventType | string,
    payload: Record<string, unknown>,
    options: PublishEventOptions = {},
  ): Promise<OutboxEventEntity> {
    const dedupKey =
      options.dedupKey ??
      this.buildDedupKey(
        options.aggregateId ?? '',
        eventType,
        options.correlationId ?? '',
      );

    const event = em.create(OutboxEventEntity, {
      aggregateId: options.aggregateId ?? null,
      aggregateType: options.aggregateType ?? null,
      eventType,
      eventVersion: options.eventVersion ?? 1,
      correlationId: options.correlationId ?? null,
      payload,
      status: OutboxEventStatus.PENDING,
      dedupKey,
      leaseHolder: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      published: false,
      retryCount: 0,
      error: null,
      publishedAt: null,
    });

    return em.save(OutboxEventEntity, event);
  }

  /**
   * Standalone publish (outside a transaction) — use only when atomicity with
   * an entity write is not required (e.g. system-generated events).
   */
  async publishEvent(
    eventType: OutboxEventType | string,
    payload: Record<string, unknown>,
    aggregateId?: string,
    aggregateType?: string,
    correlationId?: string,
  ): Promise<OutboxEventEntity> {
    const dedupKey = this.buildDedupKey(
      aggregateId ?? '',
      eventType,
      correlationId ?? '',
    );
    const event = this.outboxRepo.create({
      aggregateId: aggregateId ?? null,
      aggregateType: aggregateType ?? null,
      eventType,
      eventVersion: 1,
      correlationId: correlationId ?? null,
      payload,
      status: OutboxEventStatus.PENDING,
      dedupKey,
      leaseHolder: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      published: false,
      retryCount: 0,
      error: null,
      publishedAt: null,
    });
    return this.outboxRepo.save(event);
  }

  // ── Lease-based polling ──────────────────────────────────────────────

  /**
   * Claim up to `limit` PENDING events by acquiring a lease.
   * Events with an active lease held by another worker are skipped.
   * Events whose nextAttemptAt is in the future are skipped (backoff).
   */
  async claimPendingEvents(
    workerId: string,
    limit = 50,
  ): Promise<OutboxEventEntity[]> {
    const now = new Date();
    const leaseExpiry = new Date(now.getTime() + LEASE_TTL_MS);

    // Atomically claim events: status=PENDING, no active lease, backoff elapsed
    const result = await this.outboxRepo
      .createQueryBuilder()
      .update(OutboxEventEntity)
      .set({
        status: OutboxEventStatus.PROCESSING,
        leaseHolder: workerId,
        leaseExpiresAt: leaseExpiry,
      })
      .where('status = :status', { status: OutboxEventStatus.PENDING })
      .andWhere(
        '(lease_expires_at IS NULL OR lease_expires_at < :now)',
        { now },
      )
      .andWhere(
        '(next_attempt_at IS NULL OR next_attempt_at <= :now)',
        { now },
      )
      .andWhere('attempt_count < :max', { max: MAX_ATTEMPTS })
      .limit(limit)
      .execute();

    if (!result.affected) return [];

    return this.outboxRepo.find({
      where: {
        status: OutboxEventStatus.PROCESSING,
        leaseHolder: workerId,
      },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Renew the lease for an event being processed (heartbeat).
   */
  async renewLease(eventId: string, workerId: string): Promise<void> {
    const leaseExpiry = new Date(Date.now() + LEASE_TTL_MS);
    await this.outboxRepo.update(
      { id: eventId, leaseHolder: workerId },
      { leaseExpiresAt: leaseExpiry },
    );
  }

  /**
   * Mark an event as successfully published.
   */
  async markPublished(eventId: string): Promise<void> {
    await this.outboxRepo.update(eventId, {
      status: OutboxEventStatus.PUBLISHED,
      published: true,
      publishedAt: new Date(),
      leaseHolder: null,
      leaseExpiresAt: null,
    });
  }

  /**
   * Record a delivery failure with exponential backoff.
   * If max attempts exceeded, move to dead-letter.
   */
  async recordFailure(eventId: string, error: string): Promise<void> {
    const event = await this.outboxRepo.findOne({ where: { id: eventId } });
    if (!event) return;

    const attemptCount = event.attemptCount + 1;

    if (attemptCount >= MAX_ATTEMPTS) {
      await this.moveToDeadLetter(event, error);
      return;
    }

    const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attemptCount);
    const nextAttemptAt = new Date(Date.now() + backoffMs);

    await this.outboxRepo.update(eventId, {
      status: OutboxEventStatus.PENDING,
      attemptCount,
      lastError: error,
      error,
      retryCount: attemptCount,
      leaseHolder: null,
      leaseExpiresAt: null,
      nextAttemptAt,
    });

    this.logger.warn(
      `Outbox event ${eventId} failed (attempt ${attemptCount}/${MAX_ATTEMPTS}), retry at ${nextAttemptAt.toISOString()}`,
    );
  }

  // ── Dead-letter handling ─────────────────────────────────────────────

  private async moveToDeadLetter(
    event: OutboxEventEntity,
    lastError: string,
  ): Promise<void> {
    await this.deadLetterRepo.save(
      this.deadLetterRepo.create({
        outboxEventId: event.id,
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        correlationId: event.correlationId,
        payload: event.payload,
        attemptCount: event.attemptCount + 1,
        lastError,
        status: DeadLetterStatus.PENDING,
        operatorNotes: null,
      }),
    );

    await this.outboxRepo.update(event.id, {
      status: OutboxEventStatus.DEAD_LETTERED,
      lastError,
      leaseHolder: null,
      leaseExpiresAt: null,
    });

    this.logger.error(
      `Outbox event ${event.id} (${event.eventType}) dead-lettered after ${event.attemptCount + 1} attempts`,
    );
  }

  async getDeadLetters(
    status?: DeadLetterStatus,
  ): Promise<OutboxDeadLetterEntity[]> {
    const where = status ? { status } : {};
    return this.deadLetterRepo.find({
      where,
      order: { deadLetteredAt: 'DESC' },
    });
  }

  /**
   * Operator: replay a dead-lettered event by re-inserting it as PENDING.
   */
  async replayDeadLetter(
    deadLetterId: string,
    operatorNotes?: string,
  ): Promise<OutboxEventEntity> {
    const dl = await this.deadLetterRepo.findOne({
      where: { id: deadLetterId },
    });
    if (!dl) throw new NotFoundException(`Dead-letter '${deadLetterId}' not found`);

    // Re-insert as a fresh PENDING event with a new dedup key to avoid conflict
    const newDedupKey = `replay:${deadLetterId}:${Date.now()}`;
    const replayed = await this.outboxRepo.save(
      this.outboxRepo.create({
        aggregateId: dl.aggregateId,
        aggregateType: dl.aggregateType,
        eventType: dl.eventType,
        eventVersion: dl.eventVersion,
        correlationId: dl.correlationId,
        payload: dl.payload,
        status: OutboxEventStatus.PENDING,
        dedupKey: newDedupKey,
        leaseHolder: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        nextAttemptAt: null,
        lastError: null,
        published: false,
        retryCount: 0,
        error: null,
        publishedAt: null,
      }),
    );

    await this.deadLetterRepo.update(deadLetterId, {
      status: DeadLetterStatus.REPLAYED,
      operatorNotes: operatorNotes ?? null,
    });

    this.logger.log(
      `Dead-letter ${deadLetterId} replayed as outbox event ${replayed.id}`,
    );
    return replayed;
  }

  /**
   * Operator: discard a dead-lettered event (no further processing).
   */
  async discardDeadLetter(
    deadLetterId: string,
    operatorNotes?: string,
  ): Promise<OutboxDeadLetterEntity> {
    const dl = await this.deadLetterRepo.findOne({
      where: { id: deadLetterId },
    });
    if (!dl) throw new NotFoundException(`Dead-letter '${deadLetterId}' not found`);

    dl.status = DeadLetterStatus.DISCARDED;
    if (operatorNotes) dl.operatorNotes = operatorNotes;
    const saved = await this.deadLetterRepo.save(dl);
    this.logger.log(`Dead-letter ${deadLetterId} discarded by operator`);
    return saved;
  }

  // ── Legacy helpers (backward compat) ─────────────────────────────────

  async getUnpublishedEvents(limit = 100): Promise<OutboxEventEntity[]> {
    return this.outboxRepo.find({
      where: { published: false },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async markAsPublished(eventId: string): Promise<void> {
    return this.markPublished(eventId);
  }

  async incrementRetryCount(eventId: string, error?: string): Promise<void> {
    await this.outboxRepo.increment({ id: eventId }, 'retryCount', 1);
    if (error) await this.outboxRepo.update(eventId, { error });
  }

  async deletePublishedEvents(olderThanDays = 7): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const result = await this.outboxRepo.delete({
      published: true,
      publishedAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private buildDedupKey(
    aggregateId: string,
    eventType: string,
    correlationId: string,
  ): string {
    const raw = `${aggregateId}:${eventType}:${correlationId}:${randomUUID()}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 64);
  }
}
