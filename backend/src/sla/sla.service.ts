import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SlaRecordEntity } from './entities/sla-record.entity';
import { SlaStage } from './enums/sla-stage.enum';
import { SlaBreachQueryDto } from './dto/sla-breach-query.dto';

/** SLA budgets in seconds per stage per urgency tier */
const SLA_BUDGETS: Record<string, Record<SlaStage, number>> = {
  CRITICAL: {
    [SlaStage.TRIAGE]: 5 * 60,
    [SlaStage.MATCHING]: 10 * 60,
    [SlaStage.DISPATCH_ACCEPTANCE]: 5 * 60,
    [SlaStage.PICKUP]: 15 * 60,
    [SlaStage.DELIVERY]: 30 * 60,
  },
  URGENT: {
    [SlaStage.TRIAGE]: 10 * 60,
    [SlaStage.MATCHING]: 20 * 60,
    [SlaStage.DISPATCH_ACCEPTANCE]: 10 * 60,
    [SlaStage.PICKUP]: 30 * 60,
    [SlaStage.DELIVERY]: 60 * 60,
  },
  STANDARD: {
    [SlaStage.TRIAGE]: 30 * 60,
    [SlaStage.MATCHING]: 60 * 60,
    [SlaStage.DISPATCH_ACCEPTANCE]: 30 * 60,
    [SlaStage.PICKUP]: 90 * 60,
    [SlaStage.DELIVERY]: 180 * 60,
  },
};

export interface SlaMetrics {
  orderId: string;
  stages: Array<{
    stage: SlaStage;
    budgetSeconds: number;
    elapsedSeconds: number | null;
    pausedSeconds: number;
    breached: boolean;
    completedAt: Date | null;
  }>;
}

export interface BreachSummary {
  dimension: string;
  value: string;
  totalOrders: number;
  breachedOrders: number;
  breachRate: number;
  avgElapsedSeconds: number;
}

@Injectable()
export class SlaService {
  constructor(
    @InjectRepository(SlaRecordEntity)
    private readonly slaRepo: Repository<SlaRecordEntity>,
  ) {}

  /** Called when an order is created — opens the TRIAGE clock */
  async startStage(
    orderId: string,
    stage: SlaStage,
    context: { hospitalId: string; bloodBankId?: string; riderId?: string; urgencyTier?: string },
  ): Promise<SlaRecordEntity> {
    const tier = context.urgencyTier ?? 'STANDARD';
    const budgets = SLA_BUDGETS[tier] ?? SLA_BUDGETS['STANDARD'];

    const record = this.slaRepo.create({
      orderId,
      stage,
      hospitalId: context.hospitalId,
      bloodBankId: context.bloodBankId ?? null,
      riderId: context.riderId ?? null,
      urgencyTier: tier,
      startedAt: new Date(),
      budgetSeconds: budgets[stage],
      pauseIntervals: [],
      pausedSeconds: 0,
      breached: false,
    });

    return this.slaRepo.save(record);
  }

  /** Pause the SLA clock (e.g. waiting on external lab result) */
  async pauseStage(orderId: string, stage: SlaStage): Promise<SlaRecordEntity> {
    const record = await this.findRecord(orderId, stage);
    record.pauseIntervals = [
      ...record.pauseIntervals,
      { pausedAt: new Date().toISOString(), resumedAt: null },
    ];
    return this.slaRepo.save(record);
  }

  /** Resume a paused SLA clock */
  async resumeStage(orderId: string, stage: SlaStage): Promise<SlaRecordEntity> {
    const record = await this.findRecord(orderId, stage);
    const last = record.pauseIntervals[record.pauseIntervals.length - 1];
    if (last && !last.resumedAt) {
      last.resumedAt = new Date().toISOString();
      const pausedMs = new Date(last.resumedAt).getTime() - new Date(last.pausedAt).getTime();
      record.pausedSeconds += Math.floor(pausedMs / 1000);
    }
    return this.slaRepo.save(record);
  }

  /** Complete a stage and evaluate breach */
  async completeStage(orderId: string, stage: SlaStage): Promise<SlaRecordEntity> {
    const record = await this.findRecord(orderId, stage);
    const now = new Date();
    record.completedAt = now;
    const totalMs = now.getTime() - record.startedAt.getTime();
    record.elapsedSeconds = Math.max(0, Math.floor(totalMs / 1000) - record.pausedSeconds);
    record.breached = record.elapsedSeconds > record.budgetSeconds;
    return this.slaRepo.save(record);
  }

  /** Get all SLA records for an order */
  async getOrderMetrics(orderId: string): Promise<SlaMetrics> {
    const records = await this.slaRepo.find({ where: { orderId }, order: { createdAt: 'ASC' } });
    return {
      orderId,
      stages: records.map((r) => ({
        stage: r.stage,
        budgetSeconds: r.budgetSeconds,
        elapsedSeconds: r.elapsedSeconds,
        pausedSeconds: r.pausedSeconds,
        breached: r.breached,
        completedAt: r.completedAt,
      })),
    };
  }

  /** Query breached records with optional filters */
  async queryBreaches(query: SlaBreachQueryDto): Promise<SlaRecordEntity[]> {
    const qb = this.slaRepo.createQueryBuilder('sla').where('sla.breached = true');

    if (query.hospitalId) qb.andWhere('sla.hospitalId = :hospitalId', { hospitalId: query.hospitalId });
    if (query.bloodBankId) qb.andWhere('sla.bloodBankId = :bloodBankId', { bloodBankId: query.bloodBankId });
    if (query.riderId) qb.andWhere('sla.riderId = :riderId', { riderId: query.riderId });
    if (query.urgencyTier) qb.andWhere('sla.urgencyTier = :urgencyTier', { urgencyTier: query.urgencyTier });
    if (query.stage) qb.andWhere('sla.stage = :stage', { stage: query.stage });
    if (query.startDate) qb.andWhere('sla.startedAt >= :startDate', { startDate: query.startDate });
    if (query.endDate) qb.andWhere('sla.startedAt <= :endDate', { endDate: query.endDate });

    return qb.orderBy('sla.startedAt', 'DESC').getMany();
  }

  /** Aggregate breach rate grouped by a dimension (hospital | bloodBank | rider | urgencyTier) */
  async getBreachSummary(
    dimension: 'hospitalId' | 'bloodBankId' | 'riderId' | 'urgencyTier',
    query: SlaBreachQueryDto,
  ): Promise<BreachSummary[]> {
    const col = `sla.${dimension}`;
    const qb = this.slaRepo
      .createQueryBuilder('sla')
      .select(col, 'value')
      .addSelect('COUNT(DISTINCT sla.orderId)', 'totalOrders')
      .addSelect('COUNT(DISTINCT CASE WHEN sla.breached THEN sla.orderId END)', 'breachedOrders')
      .addSelect('AVG(sla.elapsedSeconds)', 'avgElapsedSeconds')
      .groupBy(col);

    if (query.startDate) qb.andWhere('sla.startedAt >= :startDate', { startDate: query.startDate });
    if (query.endDate) qb.andWhere('sla.startedAt <= :endDate', { endDate: query.endDate });
    if (query.stage) qb.andWhere('sla.stage = :stage', { stage: query.stage });

    const rows = await qb.getRawMany<{
      value: string;
      totalOrders: string;
      breachedOrders: string;
      avgElapsedSeconds: string;
    }>();

    return rows.map((r) => {
      const total = parseInt(r.totalOrders, 10);
      const breached = parseInt(r.breachedOrders, 10);
      return {
        dimension,
        value: r.value ?? 'unknown',
        totalOrders: total,
        breachedOrders: breached,
        breachRate: total > 0 ? Math.round((breached / total) * 10000) / 100 : 0,
        avgElapsedSeconds: Math.round(parseFloat(r.avgElapsedSeconds ?? '0')),
      };
    });
  }

  private async findRecord(orderId: string, stage: SlaStage): Promise<SlaRecordEntity> {
    const record = await this.slaRepo.findOne({ where: { orderId, stage } });
    if (!record) throw new NotFoundException(`SLA record not found for order '${orderId}' stage '${stage}'`);
    return record;
  }
}
