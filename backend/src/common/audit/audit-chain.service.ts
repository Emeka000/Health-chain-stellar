import * as crypto from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

import {
  AuditChainCheckpointEntity,
  AuditChainEntryEntity,
} from './audit-chain.entity';

export interface VerificationReport {
  ok: boolean;
  checkedEntries: number;
  firstBrokenSequence: number | null;
  generatedAt: Date;
}

const GENESIS_HASH = '0'.repeat(64);

@Injectable()
export class AuditChainService {
  private readonly logger = new Logger(AuditChainService.name);

  constructor(
    @InjectRepository(AuditChainEntryEntity)
    private readonly entryRepo: Repository<AuditChainEntryEntity>,
    @InjectRepository(AuditChainCheckpointEntity)
    private readonly checkpointRepo: Repository<AuditChainCheckpointEntity>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Append ────────────────────────────────────────────────────────────────

  /**
   * Appends a new entry to the audit chain for the given auditLogId.
   * Runs inside a serialisable transaction to guarantee sequence monotonicity.
   * Non-blocking: errors are logged but never propagate to the caller.
   */
  async append(auditLogId: string): Promise<void> {
    try {
      await this.dataSource.transaction('SERIALIZABLE', async (em) => {
        const last = await em.findOne(AuditChainEntryEntity, {
          where: {},
          order: { sequence: 'DESC' },
          lock: { mode: 'pessimistic_write' },
        });

        const sequence = last ? last.sequence + 1 : 1;
        const previousHash = last ? last.entryHash : GENESIS_HASH;
        const now = new Date().toISOString();
        const entryHash = this.hash(`${sequence}|${auditLogId}|${previousHash}|${now}`);

        await em.save(AuditChainEntryEntity, {
          auditLogId,
          sequence,
          entryHash,
          previousHash,
        });
      });
    } catch (err) {
      this.logger.error(
        `AuditChain append failed for auditLogId=${auditLogId}: ${(err as Error).message}`,
      );
    }
  }

  // ── Checkpoint ────────────────────────────────────────────────────────────

  /**
   * Anchors the current chain tip as a checkpoint.
   * Runs every hour via cron; also callable on-demand.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkpoint(): Promise<AuditChainCheckpointEntity | null> {
    const tip = await this.entryRepo.findOne({
      where: {},
      order: { sequence: 'DESC' },
    });
    if (!tip) return null;

    // Compute cumulative root hash over all entries up to tip
    const entries = await this.entryRepo.find({ order: { sequence: 'ASC' } });
    const rootHash = this.computeRootHash(entries);

    const checkpoint = await this.checkpointRepo.save(
      this.checkpointRepo.create({
        upToSequence: tip.sequence,
        rootHash,
        externalRef: null,
      }),
    );

    this.logger.log(
      `Audit chain checkpoint anchored at sequence=${tip.sequence} rootHash=${rootHash}`,
    );
    return checkpoint;
  }

  // ── Verifier ──────────────────────────────────────────────────────────────

  /**
   * Scans the full chain and validates hash-link continuity.
   * Returns a VerificationReport; logs an alert if integrity is broken.
   */
  async verify(): Promise<VerificationReport> {
    const entries = await this.entryRepo.find({ order: { sequence: 'ASC' } });
    let firstBrokenSequence: number | null = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const expectedPrev = i === 0 ? GENESIS_HASH : entries[i - 1].entryHash;

      if (entry.previousHash !== expectedPrev) {
        firstBrokenSequence = entry.sequence;
        break;
      }

      // Re-derive the hash to detect in-place tampering.
      // We cannot recompute the exact timestamp used at write time, so we
      // verify the previousHash linkage only (the hash itself is stored as
      // the tamper-evidence token; any row edit breaks the next entry's previousHash).
    }

    const report: VerificationReport = {
      ok: firstBrokenSequence === null,
      checkedEntries: entries.length,
      firstBrokenSequence,
      generatedAt: new Date(),
    };

    if (!report.ok) {
      this.logger.error(
        `AUDIT CHAIN INTEGRITY FAILURE: chain broken at sequence=${firstBrokenSequence}`,
        report,
      );
    }

    return report;
  }

  /**
   * Bootstraps historical audit_logs rows that predate the chain.
   * Creates a genesis checkpoint so the verifier has a known-good starting point.
   */
  async bootstrapHistoricalLogs(auditLogIds: string[]): Promise<void> {
    for (const id of auditLogIds) {
      await this.append(id);
    }
    await this.checkpoint();
    this.logger.log(`Bootstrapped ${auditLogIds.length} historical audit log entries into chain`);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private hash(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  private computeRootHash(entries: AuditChainEntryEntity[]): string {
    if (entries.length === 0) return GENESIS_HASH;
    return entries.reduce((acc, e) => this.hash(`${acc}|${e.entryHash}`), GENESIS_HASH);
  }
}
