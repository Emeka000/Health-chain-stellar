import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  PaginatedResponse,
  PaginationQueryDto,
  PaginationUtil,
} from '../common/pagination';

import { CreateRiderDto } from './dto/create-rider.dto';
import { RegisterRiderDto } from './dto/register-rider.dto';
import { UpdateRiderDto } from './dto/update-rider.dto';
import { RiderEntity } from './entities/rider.entity';
import { RiderStatus } from './enums/rider-status.enum';

@Injectable()
export class RidersService {
  constructor(
    @InjectRepository(RiderEntity)
    private readonly riderRepository: Repository<RiderEntity>,
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

  async updateStatus(id: string, status: RiderStatus) {
    const riderResult = await this.findOne(id);
    const rider = riderResult.data;
    rider.status = status;
    const saved = await this.riderRepository.save(rider);
    return {
      message: 'Rider status updated successfully',
      data: saved,
    };
  }

  async updateLocation(id: string, latitude: number, longitude: number) {
    const riderResult = await this.findOne(id);
    const rider = riderResult.data;
    rider.latitude = latitude;
    rider.longitude = longitude;
    const saved = await this.riderRepository.save(rider);
    return {
      message: 'Rider location updated successfully',
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

  async getNearbyRiders(latitude: number, longitude: number, radiusKm: number) {
    // Basic approximation using square bounding box before actual distance calculation if needed
    // For more accurate results, use spatial extensions or a manual formula in query
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
}
