import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { RoleEntity } from './entities/role.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { Permission } from './enums/permission.enum';
import { UserRole } from './enums/user-role.enum';

/** Redis TTL for role-permission entries (5 minutes) */
const CACHE_TTL_SECONDS = 300;
const CACHE_KEY_PREFIX = 'rbac:role:';

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepository: Repository<RolePermissionEntity>,
    @Inject(REDIS_CLIENT)
    private readonly redisClient: Redis,
  ) {}

  /**
   * Return all permissions for the given role name.
   *
   * 1. Try Redis (hot path, O(1))
   * 2. On cache miss or Redis error → query the database
   * 3. Populate the cache for subsequent requests
   */
  async getPermissionsForRole(role: string): Promise<Permission[]> {
    const cacheKey = `${CACHE_KEY_PREFIX}${role}`;

    // ── 1. Try cache ────────────────────────────────────────────────────
    try {
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as Permission[];
      }
    } catch (err) {
      this.logger.warn(
        `Redis unavailable for key "${cacheKey}", falling back to DB: ${(err as Error).message}`,
      );
    }

    // ── 2. Query DB ─────────────────────────────────────────────────────
    const roleEntity = await this.roleRepository.findOne({
      where: { name: role as UserRole },
      relations: ['permissions'],
    });

    if (!roleEntity) {
      return [];
    }

    const permissions = roleEntity.permissions.map((rp) => rp.permission);

    // ── 3. Populate cache ────────────────────────────────────────────────
    try {
      await this.redisClient.setex(
        cacheKey,
        CACHE_TTL_SECONDS,
        JSON.stringify(permissions),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to cache permissions for role "${role}": ${(err as Error).message}`,
      );
    }

    return permissions;
  }

  /**
   * Invalidate the Redis cache entry for a role so the next request
   * forces a DB refresh.
   */
  async invalidateRoleCache(role: string): Promise<void> {
    const cacheKey = `${CACHE_KEY_PREFIX}${role}`;
    try {
      await this.redisClient.del(cacheKey);
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate cache for role "${role}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * Upsert the complete permission set for a role and bust its cache.
   * Intended for admin tooling / seeding.
   */
  async setPermissionsForRole(
    role: UserRole,
    permissions: Permission[],
  ): Promise<RoleEntity> {
    let roleEntity = await this.roleRepository.findOne({
      where: { name: role },
      relations: ['permissions'],
    });

    if (!roleEntity) {
      roleEntity = this.roleRepository.create({ name: role });
    }

    // Replace permission list
    const permissionEntities = permissions.map((permission) => {
      const entity = this.rolePermissionRepository.create({ permission });
      entity.role = roleEntity as RoleEntity;
      return entity;
    });

    roleEntity.permissions = permissionEntities;
    const saved = await this.roleRepository.save(roleEntity);
    await this.invalidateRoleCache(role);
    return saved;
  }
}
