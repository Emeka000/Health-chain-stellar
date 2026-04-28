import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';

import { HospitalEntity } from '../hospitals/entities/hospital.entity';
import { HospitalStatus } from '../hospitals/enums/hospital-status.enum';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationType } from '../organizations/enums/organization-type.enum';
import { OrganizationVerificationStatus } from '../organizations/enums/organization-verification-status.enum';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { RiderEntity } from '../riders/entities/rider.entity';
import { UserEntity } from '../users/entities/user.entity';

export enum ActorType {
  BLOOD_BANK = 'BLOOD_BANK',
  HOSPITAL = 'HOSPITAL',
  PROVIDER = 'PROVIDER',       // collection centre / org provider
  RIDER = 'RIDER',
  DONOR = 'DONOR',
}

/** TTL for a positive (verified) cache entry – 5 minutes */
const VERIFIED_TTL_S = 300;
/** TTL for a negative (not-found / rejected) cache entry – 60 seconds */
const NEGATIVE_TTL_S = 60;

@Injectable()
export class ActorRegistryService {
  private readonly logger = new Logger(ActorRegistryService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(HospitalEntity)
    private readonly hospitalRepo: Repository<HospitalEntity>,
    @InjectRepository(RiderEntity)
    private readonly riderRepo: Repository<RiderEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  /**
   * Assert that `actorId` is a verified member of `expectedType`.
   * Throws ForbiddenException if the check fails.
   */
  async assertActorType(actorId: string, expectedType: ActorType): Promise<void> {
    const verified = await this.isVerifiedActor(actorId, expectedType);
    if (!verified) {
      throw new ForbiddenException(
        `Actor '${actorId}' is not a verified ${expectedType} in the registry.`,
      );
    }
  }

  /**
   * Returns true when `actorId` is a verified member of `expectedType`.
   * Results are cached in Redis with separate TTLs for positive/negative outcomes.
   */
  async isVerifiedActor(actorId: string, type: ActorType): Promise<boolean> {
    const cacheKey = `registry:${type}:${actorId}`;
    const cached = await this.redis.get(cacheKey);

    if (cached !== null) {
      return cached === '1';
    }

    const result = await this.lookupInRegistry(actorId, type);
    const ttl = result ? VERIFIED_TTL_S : NEGATIVE_TTL_S;
    await this.redis.setex(cacheKey, ttl, result ? '1' : '0');

    this.logger.debug(
      `Registry lookup ${type}:${actorId} → ${result ? 'verified' : 'not-verified'} (cached ${ttl}s)`,
    );
    return result;
  }

  /** Invalidate a cached registry entry (call after status changes). */
  async invalidateCache(actorId: string, type: ActorType): Promise<void> {
    await this.redis.del(`registry:${type}:${actorId}`);
  }

  // ── Private registry lookups ──────────────────────────────────────────────

  private async lookupInRegistry(actorId: string, type: ActorType): Promise<boolean> {
    switch (type) {
      case ActorType.BLOOD_BANK:
        return this.isVerifiedBloodBank(actorId);
      case ActorType.HOSPITAL:
        return this.isVerifiedHospital(actorId);
      case ActorType.PROVIDER:
        return this.isVerifiedProvider(actorId);
      case ActorType.RIDER:
        return this.isVerifiedRider(actorId);
      case ActorType.DONOR:
        return this.isVerifiedDonor(actorId);
    }
  }

  private async isVerifiedBloodBank(actorId: string): Promise<boolean> {
    const org = await this.orgRepo.findOne({
      where: { id: actorId, type: OrganizationType.BLOOD_BANK },
      select: ['id', 'status'],
    });
    return org?.status === OrganizationVerificationStatus.APPROVED;
  }

  private async isVerifiedHospital(actorId: string): Promise<boolean> {
    // Check both the hospitals table and the organizations table
    const hospital = await this.hospitalRepo.findOne({
      where: { id: actorId, status: HospitalStatus.ACTIVE },
      select: ['id', 'status'],
    });
    if (hospital) return true;

    const org = await this.orgRepo.findOne({
      where: { id: actorId, type: OrganizationType.HOSPITAL },
      select: ['id', 'status'],
    });
    return org?.status === OrganizationVerificationStatus.APPROVED;
  }

  private async isVerifiedProvider(actorId: string): Promise<boolean> {
    const org = await this.orgRepo.findOne({
      where: { id: actorId, type: OrganizationType.COLLECTION_CENTER },
      select: ['id', 'status'],
    });
    return org?.status === OrganizationVerificationStatus.APPROVED;
  }

  private async isVerifiedRider(actorId: string): Promise<boolean> {
    const rider = await this.riderRepo.findOne({
      where: { userId: actorId, isVerified: true },
      select: ['id', 'isVerified'],
    });
    return !!rider;
  }

  private async isVerifiedDonor(actorId: string): Promise<boolean> {
    const user = await this.userRepo.findOne({
      where: { id: actorId, isActive: true },
      select: ['id', 'isActive', 'emailVerified'],
    });
    return !!user?.emailVerified;
  }
}
