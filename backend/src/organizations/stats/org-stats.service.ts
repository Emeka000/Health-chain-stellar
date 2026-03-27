import { Injectable, ForbiddenException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import Redis from 'ioredis';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import { OrganizationEntity } from '../entities/organization.entity';
import { OrganizationType } from '../enums/organization-type.enum';
import { InventoryStockEntity } from '../../inventory/entities/inventory-stock.entity';
import { BloodRequestEntity } from '../../blood-requests/entities/blood-request.entity';
import { BloodRequestStatus } from '../../blood-requests/enums/blood-request-status.enum';
import { OrderEntity } from '../../orders/entities/order.entity';
import { OrderStatus } from '../../orders/enums/order-status.enum';

export interface OrgStats {
  organizationId: string;
  organizationType: OrganizationType | null;
  // Blood bank specific
  total_blood_units?: number;
  inventory_turnover?: number;
  // Hospital specific
  total_requests?: number;
  request_fulfillment_rate?: number;
  // Shared
  delivery_success_rate: number;
  avg_response_time: number; // seconds
  monthly_trends: number[];
  // MoM comparison
  mom_delivery_success_rate_change: number;
  mom_avg_response_time_change: number;
  // Activity timeline (last 20 events)
  activity_timeline: ActivityEvent[];
}

export interface ActivityEvent {
  type: 'REQUEST' | 'ORDER' | 'INVENTORY_UPDATE';
  id: string;
  status: string;
  timestamp: Date;
}

const CACHE_TTL_SECONDS = 300; // 5 min

@Injectable()
export class OrgStatsService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(InventoryStockEntity)
    private readonly inventoryRepo: Repository<InventoryStockEntity>,
    @InjectRepository(BloodRequestEntity)
    private readonly bloodRequestRepo: Repository<BloodRequestEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getStats(orgId: string, requestingOrgId: string): Promise<OrgStats> {
    if (orgId !== requestingOrgId) {
      throw new ForbiddenException('Access to another organization stats is not allowed');
    }

    const cacheKey = `org:stats:${orgId}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as OrgStats;

    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    const orgType = org?.type ?? null;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [
      sharedCurrent,
      sharedPrev,
      typeSpecific,
      monthlyTrends,
      timeline,
    ] = await Promise.all([
      this.calcSharedMetrics(orgId, thirtyDaysAgo, now),
      this.calcSharedMetrics(orgId, sixtyDaysAgo, thirtyDaysAgo),
      this.calcTypeSpecificMetrics(orgId, orgType, thirtyDaysAgo, now),
      this.calcMonthlyTrends(orgId, orgType),
      this.fetchActivityTimeline(orgId),
    ]);

    const momDelivery = this.percentChange(
      sharedPrev.delivery_success_rate,
      sharedCurrent.delivery_success_rate,
    );
    const momResponseTime = this.percentChange(
      sharedPrev.avg_response_time,
      sharedCurrent.avg_response_time,
    );

    const stats: OrgStats = {
      organizationId: orgId,
      organizationType: orgType,
      ...typeSpecific,
      delivery_success_rate: sharedCurrent.delivery_success_rate,
      avg_response_time: sharedCurrent.avg_response_time,
      monthly_trends: monthlyTrends,
      mom_delivery_success_rate_change: momDelivery,
      mom_avg_response_time_change: momResponseTime,
      activity_timeline: timeline,
    };

    await this.redis
      .set(cacheKey, JSON.stringify(stats), 'EX', CACHE_TTL_SECONDS)
      .catch(() => null);

    return stats;
  }

  private async calcSharedMetrics(
    orgId: string,
    from: Date,
    to: Date,
  ): Promise<{ delivery_success_rate: number; avg_response_time: number }> {
    // Delivery success rate: orders where this org is hospital or blood bank
    const [totalDispatches, successfulDeliveries] = await Promise.all([
      this.orderRepo
        .createQueryBuilder('o')
        .where('(o.hospital_id = :id OR o.blood_bank_id = :id)', { id: orgId })
        .andWhere('o.created_at BETWEEN :from AND :to', { from, to })
        .andWhere('o.status NOT IN (:...excluded)', {
          excluded: [OrderStatus.PENDING, OrderStatus.CONFIRMED],
        })
        .getCount(),
      this.orderRepo
        .createQueryBuilder('o')
        .where('(o.hospital_id = :id OR o.blood_bank_id = :id)', { id: orgId })
        .andWhere('o.created_at BETWEEN :from AND :to', { from, to })
        .andWhere('o.status = :status', { status: OrderStatus.DELIVERED })
        .getCount(),
    ]);

    const delivery_success_rate =
      totalDispatches > 0
        ? Math.round((successfulDeliveries / totalDispatches) * 100 * 100) / 100
        : 0;

    // avg_response_time: time from request creation to DISPATCHED/CONFIRMED, excluding CANCELLED
    const responseTimeResult = await this.dataSource.query<
      { avg_seconds: string | null }[]
    >(
      `SELECT AVG(EXTRACT(EPOCH FROM (o.updated_at - o.created_at))) AS avg_seconds
       FROM orders o
       WHERE (o.hospital_id = $1 OR o.blood_bank_id = $1)
         AND o.created_at BETWEEN $2 AND $3
         AND o.status IN ('${OrderStatus.DISPATCHED}', '${OrderStatus.CONFIRMED}', '${OrderStatus.DELIVERED}')`,
      [orgId, from, to],
    );

    const avg_response_time = responseTimeResult[0]?.avg_seconds
      ? Math.round(parseFloat(responseTimeResult[0].avg_seconds))
      : 0;

    return { delivery_success_rate, avg_response_time };
  }

  private async calcTypeSpecificMetrics(
    orgId: string,
    orgType: OrganizationType | null,
    from: Date,
    to: Date,
  ): Promise<Partial<OrgStats>> {
    if (orgType === OrganizationType.BLOOD_BANK) {
      const [totalUnitsResult, dispatchedResult, collectedResult] =
        await Promise.all([
          this.inventoryRepo
            .createQueryBuilder('i')
            .select('SUM(i.available_units)', 'total')
            .where('i.blood_bank_id = :id', { id: orgId })
            .getRawOne<{ total: string | null }>(),
          // dispatched = orders fulfilled from this blood bank in window
          this.orderRepo
            .createQueryBuilder('o')
            .select('SUM(o.quantity)', 'total')
            .where('o.blood_bank_id = :id', { id: orgId })
            .andWhere('o.created_at BETWEEN :from AND :to', { from, to })
            .andWhere('o.status = :status', { status: OrderStatus.DELIVERED })
            .getRawOne<{ total: string | null }>(),
          // collected = orders confirmed/received at this blood bank
          this.orderRepo
            .createQueryBuilder('o')
            .select('SUM(o.quantity)', 'total')
            .where('o.blood_bank_id = :id', { id: orgId })
            .andWhere('o.created_at BETWEEN :from AND :to', { from, to })
            .andWhere('o.status NOT IN (:...excluded)', {
              excluded: [OrderStatus.CANCELLED],
            })
            .getRawOne<{ total: string | null }>(),
        ]);

      const total_blood_units = parseInt(totalUnitsResult?.total ?? '0', 10) || 0;
      const dispatched = parseInt(dispatchedResult?.total ?? '0', 10) || 0;
      const collected = parseInt(collectedResult?.total ?? '0', 10) || 0;
      const inventory_turnover =
        collected > 0
          ? Math.round((dispatched / collected) * 100) / 100
          : 0;

      return { total_blood_units, inventory_turnover };
    }

    if (orgType === OrganizationType.HOSPITAL) {
      const [total_requests, fulfilledCount] = await Promise.all([
        this.bloodRequestRepo.count({ where: { hospitalId: orgId } }),
        this.bloodRequestRepo.count({
          where: { hospitalId: orgId, status: BloodRequestStatus.FULFILLED },
        }),
      ]);

      const request_fulfillment_rate =
        total_requests > 0
          ? Math.round((fulfilledCount / total_requests) * 100 * 100) / 100
          : 0;

      return { total_requests, request_fulfillment_rate };
    }

    return {};
  }

  private async calcMonthlyTrends(
    orgId: string,
    orgType: OrganizationType | null,
  ): Promise<number[]> {
    const now = new Date();
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    let rows: { month: string; count: string }[];

    if (orgType === OrganizationType.HOSPITAL) {
      rows = await this.dataSource.query(
        `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
                COUNT(*) AS count
         FROM blood_requests
         WHERE hospital_id = $1 AND created_at >= $2
         GROUP BY 1 ORDER BY 1`,
        [orgId, twelveMonthsAgo],
      );
    } else {
      rows = await this.dataSource.query(
        `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
                COUNT(*) AS count
         FROM orders
         WHERE (hospital_id = $1 OR blood_bank_id = $1) AND created_at >= $2
         GROUP BY 1 ORDER BY 1`,
        [orgId, twelveMonthsAgo],
      );
    }

    const countByMonth = new Map(rows.map((r) => [r.month, parseInt(r.count, 10)]));
    const trends: number[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(twelveMonthsAgo);
      d.setMonth(d.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      trends.push(countByMonth.get(key) ?? 0);
    }
    return trends;
  }

  private async fetchActivityTimeline(orgId: string): Promise<ActivityEvent[]> {
    const [requests, orders] = await Promise.all([
      this.bloodRequestRepo
        .createQueryBuilder('r')
        .select(['r.id', 'r.status', 'r.updatedAt'])
        .where('r.hospital_id = :id', { id: orgId })
        .orderBy('r.updated_at', 'DESC')
        .limit(20)
        .getMany(),
      this.orderRepo
        .createQueryBuilder('o')
        .select(['o.id', 'o.status', 'o.updatedAt'])
        .where('(o.hospital_id = :id OR o.blood_bank_id = :id)', { id: orgId })
        .orderBy('o.updated_at', 'DESC')
        .limit(20)
        .getMany(),
    ]);

    const events: ActivityEvent[] = [
      ...requests.map((r) => ({
        type: 'REQUEST' as const,
        id: r.id,
        status: r.status,
        timestamp: r.updatedAt,
      })),
      ...orders.map((o) => ({
        type: 'ORDER' as const,
        id: o.id,
        status: o.status,
        timestamp: o.updatedAt,
      })),
    ];

    return events
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 20);
  }

  private percentChange(prev: number, current: number): number {
    if (prev === 0) return current === 0 ? 0 : 100;
    return Math.round(((current - prev) / prev) * 100 * 100) / 100;
  }
}
