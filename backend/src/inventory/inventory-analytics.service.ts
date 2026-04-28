import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { LessThan, Repository } from 'typeorm';

import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { BloodStatus } from '../blood-units/enums/blood-status.enum';

import { InventoryStockEntity } from './entities/inventory-stock.entity';

export interface InventorySnapshot {
  snapshotAt: string;
  totalAvailableMl: number;
  totalReservedMl: number;
  totalAllocatedMl: number;
  byBloodType: Record<
    string,
    { availableMl: number; reservedMl: number; allocatedMl: number }
  >;
}

export interface TurnoverRate {
  bloodType: string;
  unitsConsumed: number;
  averageStockMl: number;
  turnoverRate: number; // consumed / average stock
  periodDays: number;
}

export interface WastageRecord {
  bloodType: string;
  expiredUnits: number;
  disposedUnits: number;
  totalWastedUnits: number;
  wastageRatePct: number; // wasted / (consumed + wasted) * 100
}

export interface ExpirationAnalytics {
  expiringWithin24h: number;
  expiringWithin48h: number;
  expiringWithin72h: number;
  alreadyExpiredUnits: number;
  totalAtRiskMl: number;
}

export interface TypeDistribution {
  bloodType: string;
  availableMl: number;
  sharePct: number;
}

export interface ShortagePrediction {
  bloodType: string;
  currentAvailableMl: number;
  avgDailyConsumptionMl: number;
  projectedDaysRemaining: number;
  isAtRisk: boolean; // < 3 days
}

export interface TrendPoint {
  date: string;
  totalAvailableMl: number;
  totalConsumedMl: number;
}

@Injectable()
export class InventoryAnalyticsService {
  constructor(
    @InjectRepository(InventoryStockEntity)
    private readonly stockRepo: Repository<InventoryStockEntity>,
    @InjectRepository(BloodUnit)
    private readonly bloodUnitRepo: Repository<BloodUnit>,
  ) {}

  async getSnapshot(): Promise<InventorySnapshot> {
    const stocks = await this.stockRepo.find();

    const byBloodType: InventorySnapshot['byBloodType'] = {};
    let totalAvailableMl = 0;
    let totalReservedMl = 0;
    let totalAllocatedMl = 0;

    for (const s of stocks) {
      const bt = s.bloodType as string;
      if (!byBloodType[bt]) {
        byBloodType[bt] = { availableMl: 0, reservedMl: 0, allocatedMl: 0 };
      }
      byBloodType[bt].availableMl += s.availableUnitsMl;
      byBloodType[bt].reservedMl += s.reservedUnitsMl;
      byBloodType[bt].allocatedMl += s.allocatedUnitsMl;
      totalAvailableMl += s.availableUnitsMl;
      totalReservedMl += s.reservedUnitsMl;
      totalAllocatedMl += s.allocatedUnitsMl;
    }

    return {
      snapshotAt: new Date().toISOString(),
      totalAvailableMl,
      totalReservedMl,
      totalAllocatedMl,
      byBloodType,
    };
  }

  async getTurnoverRates(periodDays = 30): Promise<TurnoverRate[]> {
    const since = new Date(Date.now() - periodDays * 86_400_000);

    const consumed = await this.bloodUnitRepo
      .createQueryBuilder('u')
      .select('u.bloodType', 'bloodType')
      .addSelect('COUNT(*)', 'count')
      .where('u.status = :status', { status: BloodStatus.DELIVERED })
      .andWhere('u.updatedAt >= :since', { since })
      .groupBy('u.bloodType')
      .getRawMany<{ bloodType: string; count: string }>();

    const stocks = await this.stockRepo
      .createQueryBuilder('s')
      .select('s.bloodType', 'bloodType')
      .addSelect('AVG(s.available_units_ml)', 'avgMl')
      .groupBy('s.bloodType')
      .getRawMany<{ bloodType: string; avgMl: string }>();

    const avgMap = new Map(
      stocks.map((s) => [s.bloodType, parseFloat(s.avgMl) || 0]),
    );

    return consumed.map((row) => {
      const unitsConsumed = parseInt(row.count, 10);
      const averageStockMl = avgMap.get(row.bloodType) ?? 0;
      return {
        bloodType: row.bloodType,
        unitsConsumed,
        averageStockMl,
        turnoverRate: averageStockMl > 0 ? unitsConsumed / averageStockMl : 0,
        periodDays,
      };
    });
  }

  async getWastageTracking(periodDays = 30): Promise<WastageRecord[]> {
    const since = new Date(Date.now() - periodDays * 86_400_000);

    const rows = await this.bloodUnitRepo
      .createQueryBuilder('u')
      .select('u.bloodType', 'bloodType')
      .addSelect(`COUNT(CASE WHEN u.status = 'expired' THEN 1 END)`, 'expired')
      .addSelect(
        `COUNT(CASE WHEN u.status = 'disposed' THEN 1 END)`,
        'disposed',
      )
      .addSelect(
        `COUNT(CASE WHEN u.status = 'delivered' THEN 1 END)`,
        'delivered',
      )
      .where('u.updatedAt >= :since', { since })
      .groupBy('u.bloodType')
      .getRawMany<{
        bloodType: string;
        expired: string;
        disposed: string;
        delivered: string;
      }>();

    return rows.map((row) => {
      const expiredUnits = parseInt(row.expired, 10) || 0;
      const disposedUnits = parseInt(row.disposed, 10) || 0;
      const deliveredUnits = parseInt(row.delivered, 10) || 0;
      const totalWastedUnits = expiredUnits + disposedUnits;
      const total = totalWastedUnits + deliveredUnits;
      return {
        bloodType: row.bloodType,
        expiredUnits,
        disposedUnits,
        totalWastedUnits,
        wastageRatePct:
          total > 0 ? Math.round((totalWastedUnits / total) * 10000) / 100 : 0,
      };
    });
  }

  async getExpirationAnalytics(): Promise<ExpirationAnalytics> {
    const now = new Date();
    const h24 = new Date(now.getTime() + 24 * 3_600_000);
    const h48 = new Date(now.getTime() + 48 * 3_600_000);
    const h72 = new Date(now.getTime() + 72 * 3_600_000);

    const [within24, within48, within72, alreadyExpired] = await Promise.all([
      this.bloodUnitRepo.count({
        where: { status: BloodStatus.AVAILABLE, expiresAt: LessThan(h24) },
      }),
      this.bloodUnitRepo.count({
        where: { status: BloodStatus.AVAILABLE, expiresAt: LessThan(h48) },
      }),
      this.bloodUnitRepo.count({
        where: { status: BloodStatus.AVAILABLE, expiresAt: LessThan(h72) },
      }),
      this.bloodUnitRepo.count({ where: { status: BloodStatus.EXPIRED } }),
    ]);

    const atRiskUnits = await this.bloodUnitRepo.find({
      where: { status: BloodStatus.AVAILABLE, expiresAt: LessThan(h72) },
      select: ['volumeMl'],
    });
    const totalAtRiskMl = atRiskUnits.reduce(
      (sum, u) => sum + (u.volumeMl ?? 0),
      0,
    );

    return {
      expiringWithin24h: within24,
      expiringWithin48h: within48,
      expiringWithin72h: within72,
      alreadyExpiredUnits: alreadyExpired,
      totalAtRiskMl,
    };
  }

  async getTypeDistribution(): Promise<TypeDistribution[]> {
    const stocks = await this.stockRepo
      .createQueryBuilder('s')
      .select('s.bloodType', 'bloodType')
      .addSelect('SUM(s.available_units_ml)', 'totalMl')
      .groupBy('s.bloodType')
      .orderBy('totalMl', 'DESC')
      .getRawMany<{ bloodType: string; totalMl: string }>();

    const grandTotal = stocks.reduce(
      (sum, s) => sum + (parseFloat(s.totalMl) || 0),
      0,
    );

    return stocks.map((s) => {
      const availableMl = parseFloat(s.totalMl) || 0;
      return {
        bloodType: s.bloodType,
        availableMl,
        sharePct:
          grandTotal > 0
            ? Math.round((availableMl / grandTotal) * 10000) / 100
            : 0,
      };
    });
  }

  async getShortagePredictions(periodDays = 7): Promise<ShortagePrediction[]> {
    const since = new Date(Date.now() - periodDays * 86_400_000);

    const consumption = await this.bloodUnitRepo
      .createQueryBuilder('u')
      .select('u.bloodType', 'bloodType')
      .addSelect('SUM(u.volumeMl)', 'totalMl')
      .where('u.status = :status', { status: BloodStatus.DELIVERED })
      .andWhere('u.updatedAt >= :since', { since })
      .groupBy('u.bloodType')
      .getRawMany<{ bloodType: string; totalMl: string }>();

    const stocks = await this.stockRepo
      .createQueryBuilder('s')
      .select('s.bloodType', 'bloodType')
      .addSelect('SUM(s.available_units_ml)', 'availableMl')
      .groupBy('s.bloodType')
      .getRawMany<{ bloodType: string; availableMl: string }>();

    const stockMap = new Map(
      stocks.map((s) => [s.bloodType, parseFloat(s.availableMl) || 0]),
    );

    return consumption.map((row) => {
      const totalConsumedMl = parseFloat(row.totalMl) || 0;
      const avgDailyConsumptionMl = totalConsumedMl / periodDays;
      const currentAvailableMl = stockMap.get(row.bloodType) ?? 0;
      const projectedDaysRemaining =
        avgDailyConsumptionMl > 0
          ? currentAvailableMl / avgDailyConsumptionMl
          : Infinity;

      return {
        bloodType: row.bloodType,
        currentAvailableMl,
        avgDailyConsumptionMl: Math.round(avgDailyConsumptionMl * 10) / 10,
        projectedDaysRemaining:
          projectedDaysRemaining === Infinity
            ? 9999
            : Math.round(projectedDaysRemaining * 10) / 10,
        isAtRisk: projectedDaysRemaining < 3,
      };
    });
  }

  async getTrendAnalysis(days = 14): Promise<TrendPoint[]> {
    const since = new Date(Date.now() - days * 86_400_000);

    const consumed = await this.bloodUnitRepo
      .createQueryBuilder('u')
      .select(`DATE(u.updatedAt)`, 'date')
      .addSelect('SUM(u.volumeMl)', 'totalMl')
      .where('u.status = :status', { status: BloodStatus.DELIVERED })
      .andWhere('u.updatedAt >= :since', { since })
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; totalMl: string }>();

    // For available stock trend we use current snapshot per blood type (simplified)
    const snapshot = await this.getSnapshot();

    return consumed.map((row) => ({
      date: row.date,
      totalAvailableMl: snapshot.totalAvailableMl,
      totalConsumedMl: parseFloat(row.totalMl) || 0,
    }));
  }
}
