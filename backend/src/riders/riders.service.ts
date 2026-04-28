import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

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
import { RiderStatus } from './enums/rider-status.enum';

const ALLOWED_STATUS_TRANSITIONS: Record<RiderStatus, RiderStatus[]> = {
  [RiderStatus.OFFLINE]: [RiderStatus.AVAILABLE],
  [RiderStatus.AVAILABLE]: [
    RiderStatus.OFFLINE,
    RiderStatus.BUSY,
    RiderStatus.ON_DELIVERY,
  ],
  [RiderStatus.BUSY]: [RiderStatus.AVAILABLE, RiderStatus.OFFLINE],
  [RiderStatus.ON_DELIVERY]: [RiderStatus.AVAILABLE, RiderStatus.OFFLINE],
};

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

  async getAvailableRiders() {
    const riders = await this.riderRepository.find({
      where: { status: RiderStatus.AVAILABLE, isVerified: true },
    });
    return {
      message: 'Available riders retrieved successfully',
      data: riders,
    };
  }

  async queryAvailability(dto: AvailabilityQueryDto) {
    const riders = await this.riderRepository.find({
      where: { status: RiderStatus.AVAILABLE, isVerified: true },
    });

    let results = riders;

    if (dto.area) {
      results = results.filter(
        (r) =>
          Array.isArray(r.preferredAreas) &&
          r.preferredAreas.some((a) =>
            a.toLowerCase().includes(dto.area!.toLowerCase()),
          ),
      );
    }

    if (
      dto.latitude !== undefined &&
      dto.longitude !== undefined &&
      dto.radiusKm !== undefined
    ) {
      results = results.filter((rider) => {
        if (rider.latitude === null || rider.longitude === null) return false;
        const latKm = Math.abs(rider.latitude - dto.latitude!) * 111;
        const lngKm =
          Math.abs(rider.longitude - dto.longitude!) *
          111 *
          Math.cos((dto.latitude! * Math.PI) / 180);
        return Math.sqrt(latKm ** 2 + lngKm ** 2) <= dto.radiusKm!;
      });
    }

    return {
      message: 'Availability query successful',
      data: results,
      total: results.length,
    };
  }

  async getNearbyRiders(latitude: number, longitude: number, radiusKm: number) {
    const riders = await this.riderRepository.find({
      where: { status: RiderStatus.AVAILABLE, isVerified: true },
    });

    const nearbyRiders = riders.filter((rider) => {
      if (rider.latitude === null || rider.longitude === null) {
        return false;
      }
      const latKm = Math.abs(rider.latitude - latitude) * 111;
      const lngKm =
        Math.abs(rider.longitude - longitude) *
        111 *
        Math.cos((latitude * Math.PI) / 180);
      return Math.sqrt(latKm ** 2 + lngKm ** 2) <= radiusKm;
    });

    return {
      message: 'Nearby riders retrieved successfully',
      data: nearbyRiders,
    };
  }

  async getPerformance(id: string): Promise<{
    message: string;
    data: {
      riderId: string;
      totalDeliveries: number;
      completedDeliveries: number;
      cancelledDeliveries: number;
      failedDeliveries: number;
      successRate: number;
      onTimeRate: number;
      rating: number;
      status: RiderStatus;
      isVerified: boolean;
    };
  }> {
    const { data: rider } = await this.findOne(id);

    const total =
      rider.completedDeliveries +
      rider.cancelledDeliveries +
      rider.failedDeliveries;

    const successRate =
      total === 0
        ? 0
        : Math.round((rider.completedDeliveries / total) * 10000) / 100;

    const onTimeRate = successRate;

    return {
      message: 'Rider performance retrieved successfully',
      data: {
        riderId: rider.id,
        totalDeliveries: total,
        completedDeliveries: rider.completedDeliveries,
        cancelledDeliveries: rider.cancelledDeliveries,
        failedDeliveries: rider.failedDeliveries,
        successRate,
        onTimeRate,
        rating: rider.rating,
        status: rider.status,
        isVerified: rider.isVerified,
      },
    };
  }

  async getLeaderboard(limit = 10): Promise<{
    message: string;
    data: Array<{
      rank: number;
      riderId: string;
      completedDeliveries: number;
      successRate: number;
      rating: number;
    }>;
  }> {
    const riders = await this.riderRepository.find({
      where: { isVerified: true },
    });

    const ranked = riders
      .map((r) => {
        const total =
          r.completedDeliveries + r.cancelledDeliveries + r.failedDeliveries;
        const successRate =
          total === 0
            ? 0
            : Math.round((r.completedDeliveries / total) * 10000) / 100;
        return {
          riderId: r.id,
          completedDeliveries: r.completedDeliveries,
          successRate,
          rating: r.rating,
        };
      })
      .sort(
        (a, b) =>
          b.completedDeliveries - a.completedDeliveries ||
          b.successRate - a.successRate ||
          b.rating - a.rating,
      )
      .slice(0, limit)
      .map((r, i) => ({ rank: i + 1, ...r }));

    return { message: 'Leaderboard retrieved successfully', data: ranked };
  }

  private emitStatusChangeEvent(rider: RiderEntity, previousStatus: RiderStatus) {
    if (
      previousStatus === RiderStatus.OFFLINE &&
      rider.status === RiderStatus.AVAILABLE
    ) {
      this.eventEmitter.emit('rider.online', { riderId: rider.id, userId: rider.userId });
    } else if (
      previousStatus !== RiderStatus.OFFLINE &&
      rider.status === RiderStatus.OFFLINE
    ) {
      this.eventEmitter.emit('rider.offline', { riderId: rider.id, userId: rider.userId });
    }

    this.eventEmitter.emit('rider.status.changed', {
      riderId: rider.id,
      userId: rider.userId,
      previousStatus,
      newStatus: rider.status,
    });
  }
}
