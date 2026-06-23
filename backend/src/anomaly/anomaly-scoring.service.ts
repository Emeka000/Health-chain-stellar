import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';

import { BloodRequestEntity, Urgency } from '../blood-requests/entities/blood-request.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/enums/order-status.enum';
import { PolicyCenterService } from '../policy-center/policy-center.service';
import { AnomalyIncidentEntity } from './entities/anomaly-incident.entity';
import {
  AnomalyType,
  AnomalySeverity,
  AnomalyStatus,
} from './enums/anomaly-type.enum';

@Injectable()
export class AnomalyScoringService {
  private readonly logger = new Logger(AnomalyScoringService.name);

  constructor(
    @InjectRepository(AnomalyIncidentEntity)
    private readonly anomalyRepo: Repository<AnomalyIncidentEntity>,
    @InjectRepository(BloodRequestEntity)
    private readonly requestRepo: Repository<BloodRequestEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly policyCenterService: PolicyCenterService,
  ) {}

  /** Run full scoring pipeline every 30 minutes */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async runPipeline(): Promise<void> {
    this.logger.log('Running anomaly scoring pipeline');

    const policy = await this.policyCenterService.getActivePolicySnapshot();
    await Promise.all([
      this.detectDuplicateEmergencyRequests(policy.rules.anomaly, policy.policyVersionId),
      this.detectRepeatedEscrowDisputes(policy.rules.anomaly, policy.policyVersionId),
      this.detectSuddenStockSwings(policy.rules.anomaly, policy.policyVersionId),
      this.detectHighRiderCancellations(policy.rules.anomaly, policy.policyVersionId),
    ]);
  }

  // ─── Rule 1: Same-day duplicate emergency requests per hospital ───────────

  private async detectDuplicateEmergencyRequests(
    rules: {
      duplicateEmergencyMinCount: number;
    },
    policyVersionRef: string,
  ): Promise<void> {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const sinceMs = since.getTime();

    const rows: { hospitalId: string; count: string }[] = await this.requestRepo
      .createQueryBuilder('r')
      .select('r.hospital_id', 'hospitalId')
      .addSelect('COUNT(*)', 'count')
      .where('r.urgency = :urgency', { urgency: Urgency.CRITICAL })
      .andWhere('r.created_timestamp >= :since', { since: sinceMs })
      .groupBy('r.hospital_id')
      .having('COUNT(*) >= :threshold', {
        threshold: rules.duplicateEmergencyMinCount,
      })
      .getRawMany();

    for (const row of rows) {
      await this.upsertAnomaly({
        type: AnomalyType.DUPLICATE_EMERGENCY_REQUEST,
        severity: AnomalySeverity.HIGH,
        hospitalId: row.hospitalId,
        description: `Hospital ${row.hospitalId} submitted ${row.count} CRITICAL blood requests today.`,
        metadata: { count: row.count, date: since.toISOString() },
        policyVersionRef,
      });
    }
  }

  // ─── Rule 2: Riders with high cancellation ratio ──────────────────────────

  private async detectHighRiderCancellations(
    rules: {
      riderMinOrders: number;
      riderCancellationRatioThreshold: number;
    },
    policyVersionRef: string,
  ): Promise<void> {
    const rows: { riderId: string; cancelled: string; total: string }[] =
      await this.orderRepo
        .createQueryBuilder('o')
        .select('o.rider_id', 'riderId')
        .addSelect(
          `SUM(CASE WHEN o.status = '${OrderStatus.CANCELLED}' THEN 1 ELSE 0 END)`,
          'cancelled',
        )
        .addSelect('COUNT(*)', 'total')
        .where('o.rider_id IS NOT NULL')
        .groupBy('o.rider_id')
        .having('COUNT(*) >= :minOrders', {
          minOrders: rules.riderMinOrders,
        })
        .andHaving(
          `SUM(CASE WHEN o.status = '${OrderStatus.CANCELLED}' THEN 1 ELSE 0 END)::float / COUNT(*) >= :threshold`,
          { threshold: rules.riderCancellationRatioThreshold },
        )
        .getRawMany();

    for (const row of rows) {
      const ratio = (Number(row.cancelled) / Number(row.total)) * 100;
      await this.upsertAnomaly({
        type: AnomalyType.RIDER_ROUTE_DEVIATION,
        severity: ratio >= 60 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
        riderId: row.riderId,
        description: `Rider ${row.riderId} has a ${ratio.toFixed(0)}% cancellation rate (${row.cancelled}/${row.total} orders).`,
        metadata: { cancelled: row.cancelled, total: row.total },
        policyVersionRef,
      });
    }
  }

  // ─── Rule 3: Repeated escrow disputes per order ───────────────────────────

  private async detectRepeatedEscrowDisputes(
    rules: {
      disputeCountThreshold: number;
    },
    policyVersionRef: string,
  ): Promise<void> {
    const rows: { hospitalId: string; count: string }[] = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.hospital_id', 'hospitalId')
      .addSelect('COUNT(*)', 'count')
      .where('o.dispute_id IS NOT NULL')
      .groupBy('o.hospital_id')
      .having('COUNT(*) >= :threshold', {
        threshold: rules.disputeCountThreshold,
      })
      .getRawMany();

    for (const row of rows) {
      await this.upsertAnomaly({
        type: AnomalyType.REPEATED_ESCROW_DISPUTE,
        severity: AnomalySeverity.HIGH,
        hospitalId: row.hospitalId,
        description: `Hospital ${row.hospitalId} has ${row.count} disputed orders.`,
        metadata: { disputeCount: row.count },
        policyVersionRef,
      });
    }
  }

  // ─── Rule 4: Sudden stock swing (many orders in short window) ─────────────

  private async detectSuddenStockSwings(
    rules: {
      stockSwingWindowMinutes: number;
      stockSwingMinOrders: number;
    },
    policyVersionRef: string,
  ): Promise<void> {
    const since = new Date(Date.now() - rules.stockSwingWindowMinutes * 60 * 1000);

    const rows: { bloodType: string; count: string }[] = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.blood_type', 'bloodType')
      .addSelect('COUNT(*)', 'count')
      .where('o.created_at >= :since', { since })
      .groupBy('o.blood_type')
      .having('COUNT(*) >= :threshold', {
        threshold: rules.stockSwingMinOrders,
      })
      .getRawMany();

    for (const row of rows) {
      await this.upsertAnomaly({
        type: AnomalyType.SUDDEN_STOCK_SWING,
        severity: AnomalySeverity.MEDIUM,
        description: `${row.count} orders for blood type ${row.bloodType} placed in the last ${rules.stockSwingWindowMinutes} minutes.`,
        metadata: { bloodType: row.bloodType, count: row.count, windowStart: since.toISOString() },
        policyVersionRef,
      });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async upsertAnomaly(data: {
    type: AnomalyType;
    severity: AnomalySeverity;
    description: string;
    metadata?: Record<string, unknown>;
    orderId?: string;
    riderId?: string;
    hospitalId?: string;
    bloodRequestId?: string;
    policyVersionRef?: string;
  }): Promise<void> {
    // Avoid duplicate open incidents for the same subject on the same day
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await this.anomalyRepo.findOne({
      where: {
        type: data.type,
        riderId: data.riderId ?? null,
        hospitalId: data.hospitalId ?? null,
        status: AnomalyStatus.OPEN,
        createdAt: MoreThan(today),
      } as any,
    });

    if (existing) {
      await this.anomalyRepo.update(existing.id, {
        description: data.description,
        metadata: data.metadata ?? null,
        severity: data.severity,
        policyVersionRef: data.policyVersionRef ?? null,
      } as any);
      return;
    }

    await this.anomalyRepo.save(
      this.anomalyRepo.create({
        ...data,
        metadata: data.metadata ?? null,
        orderId: data.orderId ?? null,
        riderId: data.riderId ?? null,
        hospitalId: data.hospitalId ?? null,
        bloodRequestId: data.bloodRequestId ?? null,
        policyVersionRef: data.policyVersionRef ?? null,
      }),
    );
  }
}
