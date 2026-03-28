import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateRegionDto } from './dto/create-region.dto';
import { QueryRegionDto } from './dto/query-region.dto';
import { RegionEntity } from './entities/region.entity';

@Injectable()
export class RegionsService {
  private readonly logger = new Logger(RegionsService.name);

  constructor(
    @InjectRepository(RegionEntity)
    private readonly regionRepo: Repository<RegionEntity>,
  ) {}

  async create(dto: CreateRegionDto): Promise<RegionEntity> {
    const existing = await this.regionRepo.findOne({
      where: { code: dto.code.toUpperCase() },
    });

    if (existing) {
      throw new ConflictException(
        `Region with code "${dto.code}" already exists`,
      );
    }

    const region = this.regionRepo.create({
      ...dto,
      code: dto.code.toUpperCase(),
      isActive: dto.isActive ?? true,
    });

    const saved = await this.regionRepo.save(region);
    this.logger.log(`Region created: ${saved.code} (${saved.name})`);
    return saved;
  }

  async findAll(query: QueryRegionDto): Promise<RegionEntity[]> {
    const qb = this.regionRepo.createQueryBuilder('region');

    if (query.code) {
      qb.andWhere('region.code = :code', { code: query.code.toUpperCase() });
    }

    if (query.countryCode) {
      qb.andWhere('region.country_code = :countryCode', {
        countryCode: query.countryCode,
      });
    }

    if (query.isActive !== undefined) {
      qb.andWhere('region.is_active = :isActive', { isActive: query.isActive });
    }

    return qb.orderBy('region.name', 'ASC').getMany();
  }

  async findOne(id: string): Promise<RegionEntity> {
    const region = await this.regionRepo.findOne({ where: { id } });
    if (!region) {
      throw new NotFoundException(`Region "${id}" not found`);
    }
    return region;
  }

  async findByCode(code: string): Promise<RegionEntity> {
    const region = await this.regionRepo.findOne({
      where: { code: code.toUpperCase() },
    });
    if (!region) {
      throw new NotFoundException(`Region with code "${code}" not found`);
    }
    return region;
  }

  async update(
    id: string,
    dto: Partial<CreateRegionDto>,
  ): Promise<RegionEntity> {
    const region = await this.findOne(id);

    if (dto.code) {
      dto.code = dto.code.toUpperCase();
    }

    Object.assign(region, dto);
    const saved = await this.regionRepo.save(region);
    this.logger.log(`Region updated: ${saved.code}`);
    return saved;
  }

  async deactivate(id: string): Promise<RegionEntity> {
    const region = await this.findOne(id);
    region.isActive = false;
    return this.regionRepo.save(region);
  }

  /**
   * Validate that a region code exists and is active.
   * Used by other services when creating region-scoped records.
   */
  async assertRegionExists(code: string): Promise<void> {
    const region = await this.regionRepo.findOne({
      where: { code: code.toUpperCase(), isActive: true },
    });
    if (!region) {
      throw new NotFoundException(
        `Active region with code "${code}" not found`,
      );
    }
  }

  /**
   * Get all active region codes. Used by services that need to fan out
   * operations across regions (e.g. notifications, escalation).
   */
  async getActiveRegionCodes(): Promise<string[]> {
    const regions = await this.regionRepo.find({
      where: { isActive: true },
      select: ['code'],
    });
    return regions.map((r) => r.code);
  }
}
