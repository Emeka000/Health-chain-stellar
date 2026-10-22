import { createHash } from 'crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginatedResponse, PaginationUtil } from '../common/pagination';

import {
  CursorResetDto,
  DiscardPoisonEventDto,
  IngestEventDto,
  QueryContractEventsDto,
  QuarantinePoisonEventDto,
  ReplayFromLedgerDto,
  ReplayPoisonEventDto,
  VerifyIndexedDto,
} from './dto/contract-event.dto';
import {
  ContractDomain,
  ContractEventEntity,
} from './entities/contract-event.entity';
import { IndexerCursorEntity } from './entities/indexer-cursor.entity';
import {
  PoisonEventEntity,
  PoisonEventStatus,
} from './entities/poison-event.entity';

export interface ReplayResult {
  domain: ContractDomain | 'all';
  projectionName: string | 'all';
  fromLedger: number;
  deletedCount: number;
  message: string;
}

export interface ReorgDetection {
  reorgDetected: boolean;
  domain: ContractDomain;
  projectionName: string;
  ledgerSequence: number;
  storedHash: string | null;
  incomingHash: string;
}

export interface VerifyResult {
  fromLedger: number;
  toLedger: number;
  domain?: ContractDomain;
  eventCount: number;
  ledgersWithEvents: number[];
  gaps: number[];
}

const GLOBAL_PROJECTION = '__global__';

@Injectable()
export class ContractEventIndexerService {
  private readonly logger = new Logger(ContractEventIndexerService.name);

  constructor(
    @InjectRepository(ContractEventEntity)
    private readonly eventRepo: Repository<ContractEventEntity>,
    @InjectRepository(IndexerCursorEntity)
    private readonly cursorRepo: Repository<IndexerCursorEntity>,
    @InjectRepository(PoisonEventEntity)
    private readonly poisonRepo: Repository<PoisonEventEntity>,
  ) {}

  // ── Ingestion ────────────────────────────────────────────────────────

  /**
   * Ingest a single contract event with exactly-once semantics.
   * Uses conflict-safe upsert: duplicate dedup keys are silently ignored.
   * The idempotency key format is: ledger:txHash:eventIndex:schemaVersion
   * or falls back to SHA-256(domain+eventType+txHash+ledger).
   *
   * When ledgerHash is provided, the cursor is checked for a reorg:
   * if the stored hash for the same ledger differs, a warning is logged
   * and the caller should trigger a replay from that ledger.
   */
  async ingest(dto: IngestEventDto): Promise<ContractEventEntity | null> {
    // Chain reorg detection: compare incoming ledger hash against stored cursor
    if (dto.ledgerHash) {
      const reorg = await this.detectReorg(dto.domain, dto.ledgerSequence, dto.ledgerHash, GLOBAL_PROJECTION);
      if (reorg.reorgDetected) {
        this.logger.warn(
          `Chain reorg detected: domain=${dto.domain} ledger=${dto.ledgerSequence} ` +
          `storedHash=${reorg.storedHash} incomingHash=${reorg.incomingHash}. ` +
          `Trigger replay from ledger ${dto.ledgerSequence} to recover.`,
        );
        // Return null — caller must replay from this ledger
        return null;
      }
    }

    const dedupKey = dto.idempotencyKey ?? this.buildDedupKey(dto);

    // Conflict-safe upsert: INSERT ... ON CONFLICT DO NOTHING
    const insertResult = await this.eventRepo
      .createQueryBuilder()
      .insert()
      .into(ContractEventEntity)
      .values({
        domain: dto.domain,
        eventType: dto.eventType,
        ledgerSequence: dto.ledgerSequence,
        txHash: dto.txHash ?? null,
        contractRef: dto.contractRef ?? null,
        payload: dto.payload,
        entityRef: dto.entityRef ?? null,
        dedupKey,
      })
      .orIgnore() // ON CONFLICT DO NOTHING
      .execute();

    if (!insertResult.identifiers.length || !insertResult.identifiers[0]?.id) {
      this.logger.debug(
        `Skipping duplicate event dedupKey=${dedupKey} domain=${dto.domain} ledger=${dto.ledgerSequence}`,
      );
      return null;
    }

    const saved = await this.eventRepo.findOne({
      where: { dedupKey },
    });

    await this.advanceCursor(dto.domain, dto.ledgerSequence, GLOBAL_PROJECTION, dto.ledgerHash);

    this.logger.log(
      `Indexed event ${dto.domain}.${dto.eventType} ledger=${dto.ledgerSequence} dedupKey=${dedupKey}`,
    );
    return saved;
  }

  /**
   * Bulk ingest — processes each event individually for dedup safety.
   * Returns count of newly persisted events.
   */
  async ingestBatch(events: IngestEventDto[]): Promise<number> {
    let count = 0;
    for (const dto of events) {
      const result = await this.ingest(dto);
      if (result) count++;
    }
    return count;
  }

  // ── Query ────────────────────────────────────────────────────────────

  async findAll(
    query: QueryContractEventsDto,
  ): Promise<PaginatedResponse<ContractEventEntity>> {
    const { page = 1, pageSize = 25 } = query;

    const qb = this.eventRepo
      .createQueryBuilder('e')
      .orderBy('e.ledger_sequence', 'DESC')
      .addOrderBy('e.indexed_at', 'DESC');

    if (query.domain)
      qb.andWhere('e.domain = :domain', { domain: query.domain });
    if (query.eventType)
      qb.andWhere('e.event_type = :eventType', { eventType: query.eventType });
    if (query.entityRef)
      qb.andWhere('e.entity_ref = :entityRef', { entityRef: query.entityRef });

    qb.skip(PaginationUtil.calculateSkip(page, pageSize)).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return PaginationUtil.createResponse(data, page, pageSize, total);
  }

  async findByEntityRef(entityRef: string): Promise<ContractEventEntity[]> {
    return this.eventRepo.find({
      where: { entityRef },
      order: { ledgerSequence: 'ASC' },
    });
  }

  async getCursors(): Promise<IndexerCursorEntity[]> {
    return this.cursorRepo.find({ order: { domain: 'ASC' } });
  }

  // ── Per-projection cursor ────────────────────────────────────────────

  /**
   * Advance the cursor for a specific projection independently.
   * Projection isolation ensures one failing projection does not stall others.
   */
  async advanceProjectionCursor(
    domain: ContractDomain,
    ledger: number,
    projectionName: string,
    ledgerHash?: string,
  ): Promise<void> {
    return this.advanceCursor(domain, ledger, projectionName, ledgerHash);
  }

  async getProjectionCursor(
    domain: ContractDomain,
    projectionName: string,
  ): Promise<IndexerCursorEntity | null> {
    return this.cursorRepo.findOne({ where: { domain, projectionName } });
  }

  // ── Chain reorg detection ────────────────────────────────────────────

  /**
   * Check whether the incoming ledger hash conflicts with the stored cursor hash.
   * A mismatch at the same ledger sequence indicates a chain reorganization.
   */
  async detectReorg(
    domain: ContractDomain,
    ledgerSequence: number,
    incomingHash: string,
    projectionName: string = GLOBAL_PROJECTION,
  ): Promise<ReorgDetection> {
    const cursor = await this.cursorRepo.findOne({ where: { domain, projectionName } });
    const storedHash = cursor?.lastLedgerHash ?? null;

    // Reorg: cursor is at the same ledger but hash differs
    const reorgDetected =
      cursor !== null &&
      cursor.lastLedger === ledgerSequence &&
      storedHash !== null &&
      storedHash !== incomingHash;

    return { reorgDetected, domain, projectionName, ledgerSequence, storedHash, incomingHash };
  }

  /**
   * Reset cursor(s) to a specific ledger without deleting indexed events.
   * Safe for operator use when a cursor is corrupted but events are valid.
   */
  async resetCursor(dto: CursorResetDto): Promise<{ reset: number; toLedger: number }> {
    const where: Partial<IndexerCursorEntity> = {};
    if (dto.domain) where.domain = dto.domain;
    if (dto.projectionName) where.projectionName = dto.projectionName;

    let reset: number;
    if (Object.keys(where).length > 0) {
      const result = await this.cursorRepo.update(where, {
        lastLedger: dto.toLedger,
        lastLedgerHash: null,
      });
      reset = (result.affected as number | undefined) ?? 0;
    } else {
      const result = await this.cursorRepo
        .createQueryBuilder()
        .update()
        .set({ lastLedger: dto.toLedger, lastLedgerHash: null })
        .where('1=1')
        .execute();
      reset = (result.affected as number | undefined) ?? 0;
    }

    this.logger.log(
      `Cursor reset: ${reset} cursor(s) set to ledger ${dto.toLedger}` +
      (dto.domain ? ` domain=${dto.domain}` : '') +
      (dto.projectionName ? ` projection=${dto.projectionName}` : ''),
    );
    return { reset, toLedger: dto.toLedger };
  }

  /**
   * Verify indexed data integrity for a ledger range.
   * Returns event count and any ledger gaps (ledgers with no events).
   */
  async verifyIndexed(dto: VerifyIndexedDto): Promise<VerifyResult> {
    const qb = this.eventRepo
      .createQueryBuilder('e')
      .select('DISTINCT e.ledger_sequence', 'ledger')
      .where('e.ledger_sequence >= :from AND e.ledger_sequence <= :to', {
        from: dto.fromLedger,
        to: dto.toLedger,
      });

    if (dto.domain) qb.andWhere('e.domain = :domain', { domain: dto.domain });

    const rows = (await qb.getRawMany()) as Array<{ ledger: string }>;
    const ledgersWithEvents = rows.map((r) => Number(r.ledger)).sort((a, b) => a - b);

    const countQb = this.eventRepo
      .createQueryBuilder('e')
      .where('e.ledger_sequence >= :from AND e.ledger_sequence <= :to', {
        from: dto.fromLedger,
        to: dto.toLedger,
      });
    if (dto.domain) countQb.andWhere('e.domain = :domain', { domain: dto.domain });
    const eventCount = await countQb.getCount();

    // Identify gaps: ledgers in range that have no events
    const ledgerSet = new Set(ledgersWithEvents);
    const gaps: number[] = [];
    for (let l = dto.fromLedger; l <= dto.toLedger; l++) {
      if (!ledgerSet.has(l)) gaps.push(l);
    }

    return { fromLedger: dto.fromLedger, toLedger: dto.toLedger, domain: dto.domain, eventCount, ledgersWithEvents, gaps };
  }

  // ── Replay ───────────────────────────────────────────────────────────

  /**
   * Delete all indexed events at or after fromLedger (optionally scoped to domain/projection)
   * and reset the cursor so the indexer will re-ingest from that point.
   * Replaying the same ledger range multiple times is idempotent after the first pass.
   */
  async replayFromLedger(dto: ReplayFromLedgerDto): Promise<ReplayResult> {
    const qb = this.eventRepo
      .createQueryBuilder()
      .delete()
      .from(ContractEventEntity)
      .where('ledger_sequence >= :from', { from: dto.fromLedger });

    if (dto.domain) {
      qb.andWhere('domain = :domain', { domain: dto.domain });
    }

    const result = await qb.execute();
    const deletedCount = (result.affected as number | undefined) ?? 0;

    // Reset cursor(s) — scoped to projection when provided
    const cursorWhere: Partial<IndexerCursorEntity> = {};
    if (dto.domain) cursorWhere.domain = dto.domain;
    if (dto.projectionName) cursorWhere.projectionName = dto.projectionName;

    if (Object.keys(cursorWhere).length > 0) {
      await this.cursorRepo.update(cursorWhere, {
        lastLedger: Math.max(0, dto.fromLedger - 1),
      });
    } else {
      await this.cursorRepo
        .createQueryBuilder()
        .update()
        .set({ lastLedger: Math.max(0, dto.fromLedger - 1) })
        .where('last_ledger >= :from', { from: dto.fromLedger })
        .execute();
    }

    this.logger.log(
      `Replay initiated: deleted ${deletedCount} events from ledger ${dto.fromLedger}` +
        (dto.domain ? ` domain=${dto.domain}` : '') +
        (dto.projectionName ? ` projection=${dto.projectionName}` : ''),
    );

    return {
      domain: dto.domain ?? 'all',
      projectionName: dto.projectionName ?? 'all',
      fromLedger: dto.fromLedger,
      deletedCount,
      message: `Deleted ${deletedCount} events. Cursors reset to ledger ${dto.fromLedger - 1}. Re-ingest to rebuild.`,
    };
  }

  // ── Poison-event handling ────────────────────────────────────────────

  /**
   * Quarantine a poison event that failed processing.
   * The event is stored for operator inspection and replay.
   */
  async quarantinePoisonEvent(
    dto: QuarantinePoisonEventDto,
  ): Promise<PoisonEventEntity> {
    const poison = this.poisonRepo.create({
      dedupKey: dto.dedupKey,
      projectionName: dto.projectionName,
      eventSnapshot: dto.payload,
      errorMessage: dto.errorMessage,
      attemptCount: dto.attemptCount ?? 1,
      status: PoisonEventStatus.QUARANTINED,
    });
    const saved = await this.poisonRepo.save(poison);
    this.logger.warn(
      `Quarantined poison event dedupKey=${dto.dedupKey} projection=${dto.projectionName} error="${dto.errorMessage}"`,
    );
    return saved;
  }

  async getPoisonEvents(
    status?: PoisonEventStatus,
  ): Promise<PoisonEventEntity[]> {
    const where = status ? { status } : {};
    return this.poisonRepo.find({
      where,
      order: { quarantinedAt: 'DESC' },
    });
  }

  /**
   * Mark a poison event as replayed (operator action).
   * The caller is responsible for actually re-processing the event.
   */
  async replayPoisonEvent(dto: ReplayPoisonEventDto): Promise<PoisonEventEntity> {
    const poison = await this.poisonRepo.findOne({
      where: { id: dto.poisonEventId },
    });
    if (!poison) {
      throw new NotFoundException(
        `Poison event '${dto.poisonEventId}' not found`,
      );
    }
    poison.status = PoisonEventStatus.REPLAYED;
    if (dto.operatorNotes) poison.operatorNotes = dto.operatorNotes;
    const saved = await this.poisonRepo.save(poison);
    this.logger.log(
      `Poison event ${dto.poisonEventId} marked as REPLAYED by operator`,
    );
    return saved;
  }

  /**
   * Discard a poison event (operator action — no further processing).
   */
  async discardPoisonEvent(
    dto: DiscardPoisonEventDto,
  ): Promise<PoisonEventEntity> {
    const poison = await this.poisonRepo.findOne({
      where: { id: dto.poisonEventId },
    });
    if (!poison) {
      throw new NotFoundException(
        `Poison event '${dto.poisonEventId}' not found`,
      );
    }
    poison.status = PoisonEventStatus.DISCARDED;
    if (dto.operatorNotes) poison.operatorNotes = dto.operatorNotes;
    const saved = await this.poisonRepo.save(poison);
    this.logger.log(
      `Poison event ${dto.poisonEventId} DISCARDED by operator`,
    );
    return saved;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Canonical dedup key: SHA-256(domain:eventType:txHash:ledgerSequence).
   * Format: ledger:txHash:eventIndex:schemaVersion when idempotencyKey is provided.
   */
  private buildDedupKey(dto: IngestEventDto): string {
    const raw = `${dto.domain}:${dto.eventType}:${dto.txHash ?? ''}:${dto.ledgerSequence}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 64);
  }

  private async advanceCursor(
    domain: ContractDomain,
    ledger: number,
    projectionName: string,
    ledgerHash?: string,
  ): Promise<void> {
    const cursor = await this.cursorRepo.findOne({
      where: { domain, projectionName },
    });
    if (!cursor) {
      await this.cursorRepo.save(
        this.cursorRepo.create({
          domain,
          projectionName,
          lastLedger: ledger,
          lastLedgerHash: ledgerHash ?? null,
        }),
      );
    } else if (ledger > cursor.lastLedger) {
      cursor.lastLedger = ledger;
      if (ledgerHash) cursor.lastLedgerHash = ledgerHash;
      await this.cursorRepo.save(cursor);
    }
  }
}
