import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import {
  PaginatedResponse,
  PaginationQueryDto,
  PaginationUtil,
} from '../common/pagination';

import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { CreateRiderDto } from './dto/create-rider.dto';
import { RegisterRiderDto } from './dto/register-rider.dto';
import { UpdateRiderDto } from './dto/update-rider.dto';
import { UpdateRiderLocationDto } from './dto/update-rider-location.dto';
import { UpdateRiderStatusDto } from './dto/update-rider-status.dto';
import { WorkingHoursDto } from './dto/working-hours.dto';
import { RiderEntity } from './entities/rider.entity';
import {
  ALLOWED_STATUS_TRANSITIONS,
  RiderStatus,
} from './enums/rider-status.enum';

/** Public record shape returned by getAvailableRiders — maps to RiderEntity */
export type RiderRecord = RiderEntity & {
  averageRating: number;
  activeDeliveries: number;
};

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class RidersService {
  constructor(
    @InjectRepository(RiderEntity)
    private readonly riderRepository: Repository<RiderEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(
    status?: RiderStatus,
    paginationDto?: PaginationQueryDto,
  ): Promise<PaginatedResponse<RiderEntity>> {
    const { page = 1, pageSize = 25 } = paginationDto || {};
    const where = status ? { status } : {};

    const [riders, totalCount] = await this.riderRepository.findAndCount({
      where,
      relations: ['user'],
      skip: PaginationUtil.calculateSkip(page, pageSize),
      take: pageSize,
    });

    return PaginationUtil.createResponse(riders, page, pageSize, totalCount);
  }

  async findOne(id: string) {
    const rider = await this.riderRepository.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!rider) {
      throw new NotFoundException(`Rider '${id}' not found`);
    }
    return {
      message: 'Rider retrieved successfully',
      data: rider,
    };
  }

  async findByUserId(userId: string) {
    const rider = await this.riderRepository.findOne({
      where: { userId },
      relations: ['user'],
    });
    if (!rider) {
      throw new NotFoundException(`Rider for user '${userId}' not found`);
    }
    return {
      message: 'Rider profile retrieved successfully',
      data: rider,
    };
  }

  async create(createRiderDto: CreateRiderDto) {
    const existing = await this.riderRepository.findOne({
      where: { userId: createRiderDto.userId },
    });
    if (existing) {
      throw new ConflictException(
        `Rider for user '${createRiderDto.userId}' already exists`,
      );
    }

    const rider = this.riderRepository.create(createRiderDto);
    const saved = await this.riderRepository.save(rider);
    return {
      message: 'Rider created successfully',
      data: saved,
    };
  }

  async register(userId: string, registerRiderDto: RegisterRiderDto) {
    const existing = await this.riderRepository.findOne({
      where: { userId },
    });
    if (existing) {
      throw new ConflictException(`Rider for user '${userId}' already exists`);
    }

    const rider = this.riderRepository.create({
      ...registerRiderDto,
      userId,
      status: RiderStatus.OFFLINE,
      isVerified: false,
    });
    const saved = await this.riderRepository.save(rider);
    return {
      message:
        'Rider registration submitted successfully. Awaiting verification.',
      data: saved,
    };
  }

  async update(id: string, updateRiderDto: UpdateRiderDto) {
    const rider = await this.findOne(id);
    const updated = Object.assign(rider.data, updateRiderDto);
    const saved = await this.riderRepository.save(updated);
    return {
      message: 'Rider updated successfully',
      data: saved,
    };
  }

  async verify(id: string) {
    const riderResult = await this.findOne(id);
    const rider = riderResult.data;
    rider.isVerified = true;
    if (rider.status === RiderStatus.OFFLINE) {
      rider.status = RiderStatus.AVAILABLE;
    }
    const saved = await this.riderRepository.save(rider);
    return {
      message: 'Rider verified successfully',
      data: saved,
    };
  }

  async remove(id: string) {
    const riderResult = await this.findOne(id);
    await this.riderRepository.remove(riderResult.data);
    return {
      message: 'Rider deleted successfully',
      data: { id },
    };
  }

  async updateStatus(id: string, dto: UpdateRiderStatusDto) {
    const riderResult = await this.findOne(id);
    const rider = riderResult.data;

    const allowedNext = ALLOWED_STATUS_TRANSITIONS[rider.status];
    if (!allowedNext.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${rider.status} to ${dto.status}. Allowed: ${allowedNext.join(', ')}`,
      );
    }

    const previousStatus = rider.status;
    rider.status = dto.status;
    const saved = await this.riderRepository.save(rider);

    this.emitStatusChangeEvent(saved, previousStatus);

    return {
      message: 'Rider status updated successfully',
      data: saved,
    };
  }

  async updateLocation(id: string, dto: UpdateRiderLocationDto) {
    const riderResult = await this.findOne(id);
    const rider = riderResult.data;
    rider.latitude = dto.latitude;
    rider.longitude = dto.longitude;
    rider.lastLocationUpdatedAt = new Date();
    const saved = await this.riderRepository.save(rider);
    return {
      message: 'Rider location updated successfully',
      data: saved,
    };
  }

  async setWorkingHours(id: string, dto: WorkingHoursDto) {
    const riderResult = await this.findOne(id);
    const rider = riderResult.data;
    rider.workingHours = {
      startHour: dto.startHour,
      endHour: dto.endHour,
      timezone: dto.timezone,
      daysOfWeek: dto.daysOfWeek,
    };
    const saved = await this.riderRepository.save(rider);
    return {
      message: 'Working hours updated successfully',
      data: saved,
    };
  }

  async setPreferredAreas(id: string, areas: string[]) {
    const riderResult = await this.findOne(id);
    const rider = riderResult.data;
    rider.preferredAreas = areas;
    const saved = await this.riderRepository.save(rider);
    return {
      message: 'Preferred areas updated successfully',
      data: saved,
    };
  }

  async getAvailableRiders(): Promise<{ message: string; data: RiderRecord[] }> {
    const riders = await this.riderRepository.find({
      where: { status: RiderStatus.AVAILABLE, isVerified: true },
    });

    const activeCounts = await this.countActiveDeliveries(
      riders.map((r) => r.id),
    );

    const data: RiderRecord[] = riders.map((r) => ({
      ...r,
      averageRating: r.rating,
      activeDeliveries: activeCounts.get(r.id) ?? 0,
    }));
    return {
      message: 'Available riders retrieved successfully',
      data,
    };
  }

  /**
   * Aggregated rider statistics for the admin dashboard.
   */
  async getStatistics(): Promise<{
    message: string;
    data: {
      total: number;
      byStatus: Record<string, number>;
      verified: number;
      available: number;
    };
  }> {
    const riders = await this.riderRepository.find();

    const byStatus: Record<string, number> = {};
    let verified = 0;
    let available = 0;

    for (const rider of riders) {
      byStatus[rider.status] = (byStatus[rider.status] ?? 0) + 1;
      if (rider.isVerified) {
        verified += 1;
      }
      if (rider.status === RiderStatus.AVAILABLE) {
        available += 1;
      }
    }

    return {
      message: 'Rider statistics retrieved successfully',
      data: {
        total: riders.length,
        byStatus,
        verified,
        available,
      },
    };
  }

  /**
   * Counts in-flight dispatches per rider so dispatch scoring reflects
   * current workload rather than lifetime completed deliveries.
   */
  private async countActiveDeliveries(
    riderIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (riderIds.length === 0) {
      return counts;
    }

    const rows = await this.riderRepository.manager
      .createQueryBuilder()
      .select('dispatch.rider_id', 'riderId')
      .addSelect('COUNT(*)', 'count')
      .from('dispatches', 'dispatch')
      .where('dispatch.rider_id IN (:...riderIds)', { riderIds })
      .andWhere('dispatch.status IN (:...activeStatuses)', {
        activeStatuses: ['assigned', 'accepted', 'picked_up', 'in_transit'],
      })
      .groupBy('dispatch.rider_id')
      .getRawMany<{ riderId: string; count: string }>();

    for (const row of rows) {
      counts.set(row.riderId, parseInt(row.count, 10));
    }
    return counts;
  }

  async getNearbyRiders(
    query: AvailabilityQueryDto,
  ): Promise<{ message: string; data: RiderRecord[] }> {
    const { latitude, longitude, radiusKm = 10 } = query;

    const qb = this.riderRepository
      .createQueryBuilder('rider')
      .where('rider.status = :status', { status: RiderStatus.AVAILABLE })
      .andWhere('rider.isVerified = :isVerified', { isVerified: true })
      .andWhere('rider.latitude IS NOT NULL')
      .andWhere('rider.longitude IS NOT NULL');

    const riders = await qb.getMany();

    const nearby = riders
      .map((r) => ({
        rider: r,
        distanceKm: haversineKm(
          latitude,
          longitude,
          Number(r.latitude),
          Number(r.longitude),
        ),
      }))
      .filter((entry) => entry.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const activeCounts = await this.countActiveDeliveries(
      nearby.map((entry) => entry.rider.id),
    );

    const data: RiderRecord[] = nearby.map((entry) => ({
      ...entry.rider,
      averageRating: entry.rider.rating,
      activeDeliveries: activeCounts.get(entry.rider.id) ?? 0,
    }));

    return {
      message: 'Nearby riders retrieved successfully',
      data,
    };
  }

  async getLeaderboard(limit = 10) {
    const riders = await this.riderRepository.find({
      where: { isVerified: true },
      relations: ['user'],
      order: { rating: 'DESC', totalDeliveries: 'DESC' },
      take: limit,
    });

    return {
      message: 'Rider leaderboard retrieved successfully',
      data: riders.map((rider, index) => ({
        rank: index + 1,
        riderId: rider.id,
        name: rider.user?.name ?? null,
        rating: rider.rating,
        totalDeliveries: rider.totalDeliveries,
      })),
    };
  }

  async getPerformance(id: string) {
    const riderResult = await this.findOne(id);
    const rider = riderResult.data;

    const activeDeliveries = await this.countActiveDeliveries([rider.id]);

    return {
      message: 'Rider performance retrieved successfully',
      data: {
        riderId: rider.id,
        rating: rider.rating,
        totalDeliveries: rider.totalDeliveries,
        activeDeliveries: activeDeliveries.get(rider.id) ?? 0,
        status: rider.status,
        isVerified: rider.isVerified,
      },
    };
  }

  private emitStatusChangeEvent(
    rider: RiderEntity,
    previousStatus: RiderStatus,
  ): void {
    this.eventEmitter.emit('rider.status.changed', {
      riderId: rider.id,
      userId: rider.userId,
      previousStatus,
      status: rider.status,
      changedAt: new Date(),
    });
  }
}
