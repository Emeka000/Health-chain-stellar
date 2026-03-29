import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, SelectQueryBuilder } from 'typeorm';
import { PolicyCenterService } from '../policy-center/policy-center.service';

import {
  InventorySortField,
  QueryBloodInventoryDto,
  SortOrder,
} from './dto/query-blood-inventory.dto';
import { BloodUnit } from './entities/blood-unit.entity';
import { BloodStatus } from './enums/blood-status.enum';
import { BloodType } from './enums/blood-type.enum';

export interface InventoryStatistics {
  total: number;
  available: number;
  reserved: number;
  inTransit: number;
  expired: number;
  expiringSoon: number;
  byBloodType: Record<string, number>;
  byComponent: Record<string, number>;
  totalVolumeMl: number;
  policyVersionRef?: string;
}

export interface AvailabilityResult {
  bloodType: BloodType;
  requiredVolumeMl: number;
  availableUnits: number;
  availableVolumeMl: number;
  isAvailable: boolean;
}

@Injectable()
export class BloodInventoryQueryService {
  constructor(
    @InjectRepository(BloodUnit)
    private readonly bloodUnitRepository: Repository<BloodUnit>,
    private readonly policyCenterService: PolicyCenterService,
  ) {}

  async query(dto: QueryBloodInventoryDto): Promise<{
    data: BloodUnit[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const qb = this.buildQuery(dto);
    const [data, total] = await qb.getManyAndCount();
    return { data, total, limit: dto.limit ?? 20, offset: dto.offset ?? 0 };
  }

  async checkAvailability(
    bloodType: BloodType,
    requiredVolumeMl: number,
  ): Promise<AvailabilityResult> {
    const now = new Date();
    const units = await this.bloodUnitRepository
      .createQueryBuilder('u')
      .where('u.bloodType = :bloodType', { bloodType })
      .andWhere('u.status = :status', { status: BloodStatus.AVAILABLE })
      .andWhere('u.expiresAt > :now', { now })
      .select(['u.id', 'u.volumeMl'])
      .getMany();

    const availableVolumeMl = units.reduce((sum, u) => sum + u.volumeMl, 0);

    return {
      bloodType,
      requiredVolumeMl,
      availableUnits: units.length,
      availableVolumeMl,
      isAvailable: availableVolumeMl >= requiredVolumeMl,
    };
  }

  async getStatistics(bankId?: string): Promise<InventoryStatistics> {
    const policy = await this.policyCenterService.getActivePolicySnapshot();
    const now = new Date();
    const soonThreshold = new Date(
      now.getTime() + policy.rules.inventory.expiringSoonHours * 60 * 60 * 1000,
    );

    const qb = this.bloodUnitRepository.createQueryBuilder('u');
    if (bankId) {
      qb.where('u.organizationId = :bankId', { bankId });
    }

    const units = await qb.getMany();

    const byBloodType: Record<string, number> = {};
    const byComponent: Record<string, number> = {};
    let available = 0;
    let reserved = 0;
    let inTransit = 0;
    let expired = 0;
    let expiringSoon = 0;
    let totalVolumeMl = 0;

    for (const unit of units) {
      byBloodType[unit.bloodType] = (byBloodType[unit.bloodType] ?? 0) + 1;
      byComponent[unit.component] = (byComponent[unit.component] ?? 0) + 1;
      totalVolumeMl += unit.volumeMl;

      if (unit.status === BloodStatus.AVAILABLE) available++;
      else if (unit.status === BloodStatus.RESERVED) reserved++;
      else if (unit.status === BloodStatus.IN_TRANSIT) inTransit++;
      else if (unit.status === BloodStatus.EXPIRED) expired++;

      if (
        unit.status === BloodStatus.AVAILABLE &&
        unit.expiresAt > now &&
        unit.expiresAt <= soonThreshold
      ) {
        expiringSoon++;
      }
    }

    return {
      total: units.length,
      available,
      reserved,
      inTransit,
      expired,
      expiringSoon,
      byBloodType,
      byComponent,
      totalVolumeMl,
      policyVersionRef: policy.policyVersionId,
    };
  }

  async findNearby(params: {
    lat: number;
    lng: number;
    radiusKm: number;
    bloodType?: BloodType;
    limit?: number;
    offset?: number;
  }): Promise<{
    data: (BloodUnit & { distanceMetres: number })[];
    total: number;
  }> {
    const radiusMetres = params.radiusKm * 1000;
    const { lat, lng, bloodType, limit = 20, offset = 0 } = params;

    // Use raw query for ST_DWithin and distance calculation
    // ST_Distance(location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)
    const query = this.bloodUnitRepository
      .createQueryBuilder('u')
      .addSelect(
        'ST_Distance(u.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)',
        'distanceMetres',
      )
      .where(
        'ST_DWithin(u.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radiusMetres)',
        { lng, lat, radiusMetres },
      )
      .andWhere('u.status = :status', { status: BloodStatus.AVAILABLE })
      .andWhere('u.expiresAt > :now', { now: new Date() });

    if (bloodType) {
      query.andWhere('u.bloodType = :bloodType', { bloodType });
    }

    query
      .orderBy('"distanceMetres"', 'ASC')
      .limit(limit)
      .offset(offset);

    const { entities, raw } = await query.getRawAndEntities();

    const data = entities.map((entity, index) => ({
      ...entity,
      distanceMetres: Math.round(raw[index].distanceMetres),
    }));

    const total = await query.getCount();

    return { data, total };
  }

  private buildQuery(
    dto: QueryBloodInventoryDto,
  ): SelectQueryBuilder<BloodUnit> {
    const qb = this.bloodUnitRepository.createQueryBuilder('u');

    if (dto.bloodType) {
      qb.andWhere('u.bloodType = :bloodType', { bloodType: dto.bloodType });
    }

    if (dto.status) {
      qb.andWhere('u.status = :status', { status: dto.status });
    }

    if (dto.component) {
      qb.andWhere('u.component = :component', { component: dto.component });
    }

    if (dto.bankId) {
      qb.andWhere('u.organizationId = :bankId', { bankId: dto.bankId });
    }

    if (dto.expiresAfter) {
      qb.andWhere('u.expiresAt > :expiresAfter', {
        expiresAfter: new Date(dto.expiresAfter),
      });
    }

    if (dto.expiresBefore) {
      qb.andWhere('u.expiresAt < :expiresBefore', {
        expiresBefore: new Date(dto.expiresBefore),
      });
    }

    if (dto.minVolumeMl !== undefined) {
      qb.andWhere('u.volumeMl >= :minVolumeMl', {
        minVolumeMl: dto.minVolumeMl,
      });
    }

    if (dto.maxVolumeMl !== undefined) {
      qb.andWhere('u.volumeMl <= :maxVolumeMl', {
        maxVolumeMl: dto.maxVolumeMl,
      });
    }

    const sortField = dto.sortBy ?? InventorySortField.EXPIRES_AT;
    const sortOrder = dto.sortOrder ?? SortOrder.ASC;
    qb.orderBy(`u.${sortField}`, sortOrder);

    qb.take(dto.limit ?? 20).skip(dto.offset ?? 0);

    return qb;
  }
}
