import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BloodUnitEntity } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/enums/order-status.enum';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationVerificationStatus } from '../organizations/enums/organization-verification-status.enum';

export interface RegionSummary {
  region: string;
  fulfilledRequests: number;
  verifiedPartners: number;
}

export interface PublicMetrics {
  fulfilledRequests: number;
  avgResponseTimeHours: number | null;
  totalDonationsRecorded: number;
  verifiedPartners: number;
  onChainVerifiedOrgs: number;
  bloodTypeBreakdown: Record<string, number>;
  geographicCoverage: RegionSummary[];
  generatedAt: string;
}

@Injectable()
export class TransparencyService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(BloodUnitEntity)
    private readonly bloodUnitRepo: Repository<BloodUnitEntity>,
  ) {}

  async getPublicMetrics(): Promise<PublicMetrics> {
    const [
      fulfilledRequests,
      avgResponseTimeHours,
      totalDonationsRecorded,
      verifiedPartners,
      onChainVerifiedOrgs,
      bloodTypeBreakdown,
      geographicCoverage,
    ] = await Promise.all([
      this.countFulfilledRequests(),
      this.computeAvgResponseTime(),
      this.countDonations(),
      this.countVerifiedPartners(),
      this.countOnChainOrgs(),
      this.getBloodTypeBreakdown(),
      this.getRegionSummaries(),
    ]);

    return {
      fulfilledRequests,
      avgResponseTimeHours,
      totalDonationsRecorded,
      verifiedPartners,
      onChainVerifiedOrgs,
      bloodTypeBreakdown,
      geographicCoverage,
      generatedAt: new Date().toISOString(),
    };
  }

  private async countFulfilledRequests(): Promise<number> {
    return this.orderRepo.count({ where: { status: OrderStatus.DELIVERED } });
  }

  private async computeAvgResponseTime(): Promise<number | null> {
    const result = await this.orderRepo
      .createQueryBuilder('o')
      .select(
        `AVG(EXTRACT(EPOCH FROM (o.updated_at - o.created_at)) / 3600)`,
        'avgHours',
      )
      .where('o.status = :status', { status: OrderStatus.DELIVERED })
      .getRawOne<{ avgHours: string | null }>();

    const val = result?.avgHours ? parseFloat(result.avgHours) : null;
    return val !== null ? Math.round(val * 10) / 10 : null;
  }

  private async countDonations(): Promise<number> {
    return this.bloodUnitRepo.count();
  }

  private async countVerifiedPartners(): Promise<number> {
    return this.orgRepo.count({
      where: { status: OrganizationVerificationStatus.APPROVED },
    });
  }

  private async countOnChainOrgs(): Promise<number> {
    return this.orgRepo
      .createQueryBuilder('o')
      .where('o.status = :status', {
        status: OrganizationVerificationStatus.APPROVED,
      })
      .andWhere('o.blockchain_tx_hash IS NOT NULL')
      .getCount();
  }

  private async getBloodTypeBreakdown(): Promise<Record<string, number>> {
    const rows = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.blood_type', 'bloodType')
      .addSelect('COUNT(*)', 'count')
      .where('o.status = :status', { status: OrderStatus.DELIVERED })
      .groupBy('o.blood_type')
      .getRawMany<{ bloodType: string; count: string }>();

    return Object.fromEntries(
      rows.map((r) => [r.bloodType, parseInt(r.count, 10)]),
    );
  }

  private async getRegionSummaries(): Promise<RegionSummary[]> {
    const orgRows = await this.orgRepo
      .createQueryBuilder('o')
      .select(`COALESCE(o.city, o.state, o.country, 'Unknown')`, 'region')
      .addSelect('COUNT(*)', 'count')
      .where('o.status = :status', {
        status: OrganizationVerificationStatus.APPROVED,
      })
      .groupBy('region')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ region: string; count: string }>();

    const regionMap = new Map<string, RegionSummary>();

    for (const row of orgRows) {
      regionMap.set(row.region, {
        region: row.region,
        fulfilledRequests: 0,
        verifiedPartners: parseInt(row.count, 10),
      });
    }

    const orderRows = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.delivery_address', 'region')
      .addSelect('COUNT(*)', 'count')
      .where('o.status = :status', { status: OrderStatus.DELIVERED })
      .andWhere('o.delivery_address IS NOT NULL')
      .groupBy('o.delivery_address')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ region: string; count: string }>();

    for (const row of orderRows) {
      const key = row.region ?? 'Unknown';
      const existing = regionMap.get(key);
      if (existing) {
        existing.fulfilledRequests += parseInt(row.count, 10);
      } else {
        regionMap.set(key, {
          region: key,
          fulfilledRequests: parseInt(row.count, 10),
          verifiedPartners: 0,
        });
      }
    }

    return [...regionMap.values()].slice(0, 10);
  }
}
