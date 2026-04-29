import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Response } from 'express';
import * as fastcsv from 'fast-csv';
import * as crypto from 'crypto';
import { DisputeEntity } from './entities/dispute.entity';
import { DisputeNoteEntity } from './entities/dispute-note.entity';
import { DisputeOutcome, DisputeSeverity, DisputeStatus, MAX_EVIDENCE_CHUNK_LENGTH, MAX_EVIDENCE_CHUNKS } from './enums/dispute.enum';
import { OpenDisputeDto, ResolveDisputeDto } from './dto/dispute.dto';
import { SorobanService } from '../soroban/soroban.service';
import {
  ReconciliationLogEntity,
  ReconciliationLogStatus,
} from '../soroban/entities/reconciliation-log.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationChannel } from '../notifications/enums/notification-channel.enum';

const MAX_LIMIT = 100;
const CURSOR_SECRET = process.env.CURSOR_SECRET ?? 'disputes-cursor-secret';
const DEFAULT_DISPUTE_TIMEOUT_SECONDS = 72 * 60 * 60;

function encodeCursor(createdAt: Date, id: string): string {
  const payload = JSON.stringify({ t: createdAt.toISOString(), id });
  return Buffer.from(payload).toString('base64url');
}

function decodeCursor(cursor: string): { t: string; id: string } | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

@Injectable()
export class DisputesService {
  constructor(
    @InjectRepository(DisputeEntity)
    private readonly disputeRepo: Repository<DisputeEntity>,
    @InjectRepository(DisputeNoteEntity)
    private readonly noteRepo: Repository<DisputeNoteEntity>,
    @InjectRepository(ReconciliationLogEntity)
    private readonly reconciliationLogRepo: Repository<ReconciliationLogEntity>,
    private readonly sorobanService: SorobanService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async open(dto: OpenDisputeDto, openedBy: string): Promise<DisputeEntity> {
    const timeoutOwner: 'CHAIN' | 'BACKEND' = dto.paymentId ? 'CHAIN' : 'BACKEND';
    const deadline = new Date(Date.now() + DEFAULT_DISPUTE_TIMEOUT_SECONDS * 1000);
    const dispute = this.disputeRepo.create({
      orderId: dto.orderId ?? null,
      paymentId: dto.paymentId ?? null,
      reason: dto.reason,
      severity: dto.severity ?? DisputeSeverity.MEDIUM,
      description: dto.description ?? null,
      openedBy,
      status: DisputeStatus.OPEN,
      timeoutOwner,
      timeoutDeadlineAt: deadline,
      timeoutProcessedAt: null,
      timeoutDecisionReason: null,
    });
    return this.disputeRepo.save(dispute);
  }

  async list(filters: {
    status?: DisputeStatus;
    severity?: DisputeSeverity;
    assignedTo?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: DisputeEntity[]; nextCursor: string | null }> {
    const limit = Math.min(filters.limit ?? 20, MAX_LIMIT);
    const qb = this.disputeRepo.createQueryBuilder('d');

    if (filters.status) qb.andWhere('d.status = :status', { status: filters.status });
    if (filters.severity) qb.andWhere('d.severity = :severity', { severity: filters.severity });
    if (filters.assignedTo) qb.andWhere('d.assignedTo = :assignedTo', { assignedTo: filters.assignedTo });

    if (filters.cursor) {
      const decoded = decodeCursor(filters.cursor);
      if (decoded) {
        qb.andWhere(
          '(d.createdAt, d.id) < (:t::timestamptz, :id)',
          { t: decoded.t, id: decoded.id },
        );
      }
    }

    const rows = await qb
      .orderBy('d.createdAt', 'DESC')
      .addOrderBy('d.id', 'DESC')
      .limit(limit + 1)
      .getMany();

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCursor(data[data.length - 1].createdAt, data[data.length - 1].id) : null;

    return { data, nextCursor };
  }

  async get(id: string): Promise<DisputeEntity> {
    const d = await this.disputeRepo.findOne({ where: { id } });
    if (!d) throw new NotFoundException(`Dispute '${id}' not found`);
    return d;
  }

  async assign(id: string, operatorId: string): Promise<DisputeEntity> {
    const d = await this.get(id);
    d.assignedTo = operatorId;
    d.status = DisputeStatus.UNDER_REVIEW;
    return this.disputeRepo.save(d);
  }

  async resolve(id: string, dto: ResolveDisputeDto): Promise<DisputeEntity> {
    const d = await this.get(id);
    d.resolutionNotes = dto.resolutionNotes;
    d.outcome = dto.outcome;
    d.resolvedBy = dto.resolvedBy;
    d.status = DisputeStatus.RESOLVED;
    d.resolvedAt = new Date();
    d.timeoutProcessedAt = d.timeoutProcessedAt ?? new Date();
    d.timeoutDecisionReason = d.timeoutDecisionReason ?? 'manual_resolution';
    return this.disputeRepo.save(d);
  }

  async addNote(id: string, content: string, authorId: string): Promise<DisputeNoteEntity> {
    await this.get(id);
    return this.noteRepo.save(this.noteRepo.create({ disputeId: id, content, authorId }));
  }

  async getNotes(id: string): Promise<DisputeNoteEntity[]> {
    return this.noteRepo.find({ where: { disputeId: id }, order: { createdAt: 'ASC' } });
  }

  async addEvidence(id: string, evidence: { type: string; url: string }): Promise<DisputeEntity> {
    const d = await this.get(id);
    const existing = d.evidence ?? [];

    if (existing.length >= MAX_EVIDENCE_CHUNKS) {
      throw new BadRequestException(
        `Evidence chunk limit of ${MAX_EVIDENCE_CHUNKS} reached for dispute '${id}'`,
      );
    }
    if (evidence.url.length > MAX_EVIDENCE_CHUNK_LENGTH) {
      throw new BadRequestException(
        `Evidence URL exceeds maximum length of ${MAX_EVIDENCE_CHUNK_LENGTH} characters`,
      );
    }

    const updated = [...existing, { ...evidence, addedAt: new Date().toISOString() }];
    d.evidence = updated;
    d.evidenceDigest = this.canonicalEvidenceDigest(updated);
    return this.disputeRepo.save(d);
  }

  /**
   * Canonical digest: sort chunks by url, join with newline, SHA-256.
   * Backend proof bundles must reproduce this exact digest to match on-chain.
   */
  private canonicalEvidenceDigest(
    chunks: Array<{ type: string; url: string; addedAt: string }>,
  ): string {
    const sorted = [...chunks].sort((a, b) => a.url.localeCompare(b.url));
    const payload = sorted.map((c) => `${c.type}:${c.url}`).join('\n');
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  async streamCsvExport(
    res: Response,
    filters: { status?: DisputeStatus; from?: string; to?: string },
  ): Promise<void> {
    const qb = this.disputeRepo
      .createQueryBuilder('d')
      .select([
        'd.id', 'd.orderId', 'd.paymentId', 'd.reason', 'd.severity',
        'd.status', 'd.openedBy', 'd.assignedTo', 'd.createdAt', 'd.resolvedAt',
      ])
      .orderBy('d.createdAt', 'ASC');

    if (filters.status) qb.andWhere('d.status = :status', { status: filters.status });
    if (filters.from) qb.andWhere('d.createdAt >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('d.createdAt <= :to', { to: filters.to });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="disputes.csv"');

    const csvStream = fastcsv.format({ headers: true });
    csvStream.pipe(res);

    const BATCH = 500;
    let offset = 0;

    while (true) {
      const rows = await qb.skip(offset).take(BATCH).getMany();
      if (rows.length === 0) break;

      for (const r of rows) {
        csvStream.write({
          id: r.id,
          orderId: r.orderId ?? '',
          paymentId: r.paymentId ?? '',
          reason: r.reason,
          severity: r.severity,
          status: r.status,
          openedBy: r.openedBy,
          assignedTo: r.assignedTo ?? '',
          createdAt: r.createdAt.toISOString(),
          resolvedAt: r.resolvedAt?.toISOString() ?? '',
        });
      }

      if (rows.length < BATCH) break;
      offset += BATCH;
    }

    csvStream.end();
  }

  async scanAndProcessExpiredDisputes(now = new Date()): Promise<number> {
    const candidates = await this.disputeRepo.find({
      where: [
        {
          status: DisputeStatus.OPEN,
          timeoutDeadlineAt: LessThanOrEqual(now),
          timeoutProcessedAt: IsNull(),
        },
        {
          status: DisputeStatus.UNDER_REVIEW,
          timeoutDeadlineAt: LessThanOrEqual(now),
          timeoutProcessedAt: IsNull(),
        },
      ],
      order: { timeoutDeadlineAt: 'ASC' },
      take: 100,
    });

    let processed = 0;
    for (const dispute of candidates) {
      const didResolve = await this.processSingleTimeout(dispute.id, now);
      if (didResolve) processed += 1;
    }
    return processed;
  }

  private async processSingleTimeout(disputeId: string, now: Date): Promise<boolean> {
    const dispute = await this.disputeRepo.findOne({ where: { id: disputeId } });
    if (!dispute) return false;
    if (dispute.status === DisputeStatus.RESOLVED || dispute.status === DisputeStatus.CLOSED) return false;
    if (dispute.timeoutProcessedAt) return false;
    if (!dispute.timeoutDeadlineAt || dispute.timeoutDeadlineAt.getTime() > now.getTime()) return false;

    const onChain = dispute.contractDisputeId
      ? await this.sorobanService.getDisputeState(dispute.contractDisputeId)
      : null;

    // Contract semantics: if already resolved on-chain, avoid duplicate backend resolution.
    if (onChain?.status && onChain.status.toLowerCase().includes('resolved')) {
      const affected = await this.disputeRepo.update(
        { id: dispute.id, timeoutProcessedAt: IsNull() as any },
        {
          timeoutProcessedAt: now,
          timeoutDecisionReason: 'on_chain_already_resolved',
        },
      );
      if (affected.affected && affected.affected > 0) {
        await this.persistTimeoutReconciliationLog(dispute, 'RESOLVED_ON_CHAIN', now, onChain.status);
      }
      return false;
    }

    const decision = this.determineTimeoutResolution(dispute);
    const updateResult = await this.disputeRepo.update(
      {
        id: dispute.id,
        timeoutProcessedAt: IsNull() as any,
      },
      {
        status: DisputeStatus.RESOLVED,
        outcome: decision.outcome,
        resolvedBy: 'SYSTEM_TIMEOUT_SCANNER',
        resolvedAt: now,
        resolutionNotes: decision.notes,
        timeoutProcessedAt: now,
        timeoutDecisionReason: decision.reason,
      },
    );

    // Race-safe idempotency: if no row updated, manual or concurrent worker resolved it first.
    if (!updateResult.affected || updateResult.affected < 1) return false;

    await this.persistTimeoutReconciliationLog(dispute, 'AUTO_RESOLVED_TIMEOUT', now, onChain?.status);
    await this.sendTimeoutNotifications(dispute, decision.reason).catch(() => undefined);
    return true;
  }

  private determineTimeoutResolution(dispute: DisputeEntity): {
    outcome: DisputeOutcome;
    reason: string;
    notes: string;
  } {
    // Contract-aligned deterministic rule:
    // expired unresolved disputes auto-resolve in favor of payer.
    return {
      outcome: DisputeOutcome.PAYER_WIN,
      reason: 'expired_timeout_auto_refund_policy',
      notes: `Dispute auto-resolved by timeout scanner at deadline ${dispute.timeoutDeadlineAt?.toISOString() ?? 'unknown'}`,
    };
  }

  private async persistTimeoutReconciliationLog(
    dispute: DisputeEntity,
    action: 'AUTO_RESOLVED_TIMEOUT' | 'RESOLVED_ON_CHAIN',
    at: Date,
    onChainStatus?: string,
  ): Promise<void> {
    const log = this.reconciliationLogRepo.create({
      onChainPaymentId: dispute.contractDisputeId ?? dispute.id,
      orderId: dispute.orderId,
      eventType:
        action === 'AUTO_RESOLVED_TIMEOUT'
          ? 'dispute.timeout.auto_resolved'
          : 'dispute.timeout.on_chain_resolved',
      ledgerSequence: 0,
      onChainPaymentStatus: onChainStatus ?? 'unknown',
      offChainPaymentStatus: action === 'AUTO_RESOLVED_TIMEOUT' ? 'resolved' : dispute.status,
      status:
        action === 'AUTO_RESOLVED_TIMEOUT'
          ? ReconciliationLogStatus.RESOLVED
          : ReconciliationLogStatus.DISCREPANCY,
      discrepancyDetail:
        action === 'AUTO_RESOLVED_TIMEOUT'
          ? null
          : 'On-chain dispute already resolved before backend timeout action',
      resolvedAt: at,
    });
    await this.reconciliationLogRepo.save(log);
  }

  private async sendTimeoutNotifications(dispute: DisputeEntity, reason: string): Promise<void> {
    const recipients = [dispute.openedBy, dispute.assignedTo].filter(Boolean) as string[];
    for (const recipientId of recipients) {
      await this.notificationsService.send({
        recipientId,
        channels: [NotificationChannel.IN_APP],
        templateKey: 'dispute.timeout.auto_resolved',
        variables: {
          disputeId: dispute.id,
          orderId: dispute.orderId,
          reason,
        },
      });
    }
  }
}
