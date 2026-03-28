import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';

import { BloodRequestEntity, Urgency } from '../blood-requests/entities/blood-request.entity';
import { BloodRequestStatus } from '../blood-requests/enums/blood-request-status.enum';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { BloodStatus } from '../blood-units/enums/blood-status.enum';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationType } from '../organizations/enums/organization-type.enum';

import { InventoryStockEntity } from './entities/inventory-stock.entity';

export interface ExpiringUnit {
  unitId: string;
  unitCode: string;
  bloodType: string;
  volumeMl: number;
  expiresAt: Date;
  hoursRemaining: number;
  organizationId: string;
  organizationName: string | null;
}

export interface ExpirationWindow {
  windowLabel: string; // e.g. "< 24h", "24–48h", "48–72h"
  hoursMax: number;
  units: ExpiringUnit[];
  totalVolumeMl: number;
}

export interface TransferRecommendation {
  fromBankId: string;
  fromBankName: string | null;
  toBankId: string;
  toBankName: string | null;
  bloodType: string;
  unitsToTransfer: number;
  urgencyScore: number; // higher = more urgent
  distanceKm: number | null;
  expiringWithinHours: number;
  demandUrgency: Urgency | null;
}

@Injectable()
export class ExpirationForecastingService {
  constructor(
    @InjectRepository(BloodUnit)
    private readonly bloodUnitRepo: Repository<BloodUnit>,
    @InjectRepository(InventoryStockEntity)
    private readonly stockRepo: Repository<InventoryStockEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(BloodRequestEntity)
    private readonly requestRepo: Repository<BloodRequestEntity>,
  ) {}

  /** Returns units expiring within `horizonHours` grouped into windows */
  async getExpirationForecast(horizonHours = 72): Promise<ExpirationWindow[]> {
    const cutoff = new Date(Date.now() + horizonHours * 3_600_000);
    const now = new Date();

    const units = await this.bloodUnitRepo.find({
      where: {
        status: BloodStatus.AVAILABLE,
        expiresAt: LessThan(cutoff),
      },
      order: { expiresAt: 'ASC' },
    });

    const orgIds = [...new Set(units.map((u) => u.organizationId))];
    const orgs = orgIds.length
      ? await this.orgRepo.findByIds(orgIds)
      : [];
    const orgMap = new Map(orgs.map((o) => [o.id, o.name]));

    const windows: ExpirationWindow[] = [
      { windowLabel: '< 24h', hoursMax: 24, units: [], totalVolumeMl: 0 },
      { windowLabel: '24–48h', hoursMax: 48, units: [], totalVolumeMl: 0 },
      { windowLabel: '48–72h', hoursMax: 72, units: [], totalVolumeMl: 0 },
    ];

    for (const u of units) {
      const hoursRemaining = (u.expiresAt.getTime() - now.getTime()) / 3_600_000;
      if (hoursRemaining < 0) continue;

      const item: ExpiringUnit = {
        unitId: u.id,
        unitCode: u.unitCode,
        bloodType: u.bloodType,
        volumeMl: u.volumeMl,
        expiresAt: u.expiresAt,
        hoursRemaining: Math.round(hoursRemaining * 10) / 10,
        organizationId: u.organizationId,
        organizationName: orgMap.get(u.organizationId) ?? null,
      };

      const win = windows.find((w) => hoursRemaining <= w.hoursMax);
      if (win) {
        win.units.push(item);
        win.totalVolumeMl += u.volumeMl;
      }
    }

    return windows;
  }

  /** Compute transfer recommendations: surplus expiring banks → shortage banks */
  async getRebalancingRecommendations(): Promise<TransferRecommendation[]> {
    const [stocks, orgs, pendingRequests] = await Promise.all([
      this.stockRepo.find(),
      this.orgRepo.find({ where: { type: OrganizationType.BLOOD_BANK } }),
      this.requestRepo.find({
        where: { status: BloodRequestStatus.PENDING },
        select: ['hospitalId', 'bloodType', 'urgency'],
      }),
    ]);

    const orgMap = new Map(orgs.map((o) => [o.id, o]));

    // Demand urgency per blood type (highest urgency wins)
    const demandMap = new Map<string, Urgency>();
    const urgencyRank: Record<Urgency, number> = {
      [Urgency.CRITICAL]: 4,
      [Urgency.URGENT]: 3,
      [Urgency.ROUTINE]: 2,
      [Urgency.SCHEDULED]: 1,
    };
    for (const req of pendingRequests) {
      const existing = demandMap.get(req.bloodType);
      if (!existing || urgencyRank[req.urgency] > urgencyRank[existing]) {
        demandMap.set(req.bloodType, req.urgency);
      }
    }

    // Expiring units per bank per blood type (within 48h)
    const cutoff48h = new Date(Date.now() + 48 * 3_600_000);
    const expiringUnits = await this.bloodUnitRepo.find({
      where: { status: BloodStatus.AVAILABLE, expiresAt: LessThan(cutoff48h) },
    });

    // surplus[bankId][bloodType] = count of expiring units
    const surplus = new Map<string, Map<string, number>>();
    for (const u of expiringUnits) {
      if (!surplus.has(u.organizationId)) surplus.set(u.organizationId, new Map());
      const bt = surplus.get(u.organizationId)!;
      bt.set(u.bloodType, (bt.get(u.bloodType) ?? 0) + 1);
    }

    // shortage[bankId][bloodType] = available units
    const shortage = new Map<string, Map<string, number>>();
    for (const s of stocks) {
      if (!shortage.has(s.bloodBankId)) shortage.set(s.bloodBankId, new Map());
      shortage.get(s.bloodBankId)!.set(s.bloodType, s.availableUnits);
    }

    const recommendations: TransferRecommendation[] = [];

    for (const [fromBankId, btMap] of surplus.entries()) {
      const fromOrg = orgMap.get(fromBankId);

      for (const [bloodType, expiringCount] of btMap.entries()) {
        // Find banks with low stock for this blood type
        for (const [toBankId, toStockMap] of shortage.entries()) {
          if (toBankId === fromBankId) continue;
          const toStock = toStockMap.get(bloodType) ?? 0;
          if (toStock >= 5) continue; // not in shortage

          const toOrg = orgMap.get(toBankId);
          const distanceKm = this.haversineKm(fromOrg, toOrg);
          const hoursRemaining = this.minHoursRemaining(expiringUnits, fromBankId, bloodType);
          const demand = demandMap.get(bloodType) ?? null;

          // Score: urgency weight + freshness penalty + distance penalty
          const urgencyWeight = demand ? urgencyRank[demand] : 1;
          const freshnessScore = Math.max(0, 48 - hoursRemaining); // higher = more urgent
          const distancePenalty = distanceKm !== null ? Math.min(distanceKm / 100, 5) : 0;
          const urgencyScore = Math.round((urgencyWeight * 10 + freshnessScore - distancePenalty) * 10) / 10;

          recommendations.push({
            fromBankId,
            fromBankName: fromOrg?.name ?? null,
            toBankId,
            toBankName: toOrg?.name ?? null,
            bloodType,
            unitsToTransfer: Math.min(expiringCount, 5 - toStock),
            urgencyScore,
            distanceKm,
            expiringWithinHours: Math.round(hoursRemaining * 10) / 10,
            demandUrgency: demand,
          });
        }
      }
    }

    // Sort by urgency score descending
    return recommendations.sort((a, b) => b.urgencyScore - a.urgencyScore);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private minHoursRemaining(
    units: BloodUnit[],
    bankId: string,
    bloodType: string,
  ): number {
    const now = Date.now();
    const relevant = units.filter(
      (u) => u.organizationId === bankId && u.bloodType === bloodType,
    );
    if (!relevant.length) return 48;
    return Math.min(...relevant.map((u) => (u.expiresAt.getTime() - now) / 3_600_000));
  }

  private haversineKm(
    a: OrganizationEntity | undefined,
    b: OrganizationEntity | undefined,
  ): number | null {
    if (!a?.latitude || !a?.longitude || !b?.latitude || !b?.longitude) return null;
    const R = 6371;
    const dLat = this.toRad(Number(b.latitude) - Number(a.latitude));
    const dLon = this.toRad(Number(b.longitude) - Number(a.longitude));
    const lat1 = this.toRad(Number(a.latitude));
    const lat2 = this.toRad(Number(b.latitude));
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 10) / 10;
  }

  private toRad(deg: number) {
    return (deg * Math.PI) / 180;
  }
}
