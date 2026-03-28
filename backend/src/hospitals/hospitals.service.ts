import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpsertCapacityConfigDto } from './dto/hospital-capacity-config.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { HospitalCapacityConfigEntity } from './entities/hospital-capacity-config.entity';
import { HospitalEntity } from './entities/hospital.entity';

@Injectable()
export class HospitalsService {
  private readonly logger = new Logger(HospitalsService.name);

  constructor(
    @InjectRepository(HospitalEntity)
    private readonly hospitalRepo: Repository<HospitalEntity>,
    @InjectRepository(HospitalCapacityConfigEntity)
    private readonly capacityRepo: Repository<HospitalCapacityConfigEntity>,
  ) {}

  async findAll(): Promise<{ message: string; data: HospitalEntity[] }> {
    const data = await this.hospitalRepo.find({
      order: { name: 'ASC' },
    });
    return { message: 'Hospitals retrieved successfully', data };
  }

  async findOne(
    id: string,
  ): Promise<{ message: string; data: HospitalEntity }> {
    const hospital = await this.hospitalRepo.findOne({
      where: { id },
      relations: ['capacityConfig'],
    });
    if (!hospital) {
      throw new NotFoundException(`Hospital "${id}" not found`);
    }
    return { message: 'Hospital retrieved successfully', data: hospital };
  }

  async create(
    dto: CreateHospitalDto,
  ): Promise<{ message: string; data: HospitalEntity }> {
    const hospital = this.hospitalRepo.create({
      ...dto,
      regionCode: dto.regionCode ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      phoneNumber: dto.phoneNumber ?? null,
      email: dto.email ?? null,
      metadata: dto.metadata ?? null,
    });
    const saved = await this.hospitalRepo.save(hospital);
    this.logger.log(`Hospital created: ${saved.id} (${saved.name})`);
    return { message: 'Hospital created successfully', data: saved };
  }

  async update(
    id: string,
    dto: UpdateHospitalDto,
  ): Promise<{ message: string; data: HospitalEntity }> {
    const { data: hospital } = await this.findOne(id);
    Object.assign(hospital, dto);
    const saved = await this.hospitalRepo.save(hospital);
    return { message: 'Hospital updated successfully', data: saved };
  }

  async remove(id: string): Promise<{ message: string; data: { id: string } }> {
    const { data: hospital } = await this.findOne(id);
    await this.hospitalRepo.remove(hospital);
    return { message: 'Hospital deleted successfully', data: { id } };
  }

  async getNearbyHospitals(
    latitude: number,
    longitude: number,
    radiusKm: number,
  ): Promise<{ message: string; data: HospitalEntity[] }> {
    // Haversine approximation via raw query
    const data = await this.hospitalRepo
      .createQueryBuilder('hospital')
      .where(
        `(
          6371 * acos(
            cos(radians(:lat)) * cos(radians(hospital.latitude)) *
            cos(radians(hospital.longitude) - radians(:lng)) +
            sin(radians(:lat)) * sin(radians(hospital.latitude))
          )
        ) <= :radius`,
        { lat: latitude, lng: longitude, radius: radiusKm },
      )
      .andWhere('hospital.latitude IS NOT NULL')
      .andWhere('hospital.longitude IS NOT NULL')
      .orderBy('hospital.name', 'ASC')
      .getMany();

    return { message: 'Nearby hospitals retrieved successfully', data };
  }

  // ── Capacity config ───────────────────────────────────────────────────────

  async upsertCapacityConfig(
    hospitalId: string,
    dto: UpsertCapacityConfigDto,
  ): Promise<{ message: string; data: HospitalCapacityConfigEntity }> {
    await this.findOne(hospitalId); // ensure hospital exists

    let config = await this.capacityRepo.findOne({ where: { hospitalId } });
    if (!config) {
      config = this.capacityRepo.create({ hospitalId });
    }

    Object.assign(config, {
      coldStorageCapacityUnits: dto.coldStorageCapacityUnits,
      currentStorageUnits:
        dto.currentStorageUnits ?? config.currentStorageUnits ?? 0,
      receivingWindows: dto.receivingWindows ?? config.receivingWindows ?? null,
      blackoutPeriods: dto.blackoutPeriods ?? config.blackoutPeriods ?? null,
      allowEmergencyOverride:
        dto.allowEmergencyOverride ?? config.allowEmergencyOverride ?? true,
      intakeBufferMinutes:
        dto.intakeBufferMinutes ?? config.intakeBufferMinutes ?? 30,
      isEnforced: dto.isEnforced ?? config.isEnforced ?? true,
    });

    const saved = await this.capacityRepo.save(config);
    this.logger.log(`Capacity config upserted for hospital ${hospitalId}`);
    return { message: 'Capacity config updated successfully', data: saved };
  }

  async getCapacityConfig(
    hospitalId: string,
  ): Promise<{ message: string; data: HospitalCapacityConfigEntity | null }> {
    await this.findOne(hospitalId);
    const config = await this.capacityRepo.findOne({ where: { hospitalId } });
    return {
      message: 'Capacity config retrieved successfully',
      data: config ?? null,
    };
  }
}
