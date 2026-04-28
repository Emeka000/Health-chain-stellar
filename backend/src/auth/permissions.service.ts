import { Injectable, Inject, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import Redis from 'ioredis';
import { Repository } from 'typeorm';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { ActivityType } from '../user-activity/enums/activity-type.enum';
import { UserActivityService } from '../user-activity/user-activity.service';

import { RolePermissionEntity } from './entities/role-permission.entity';
import { RoleEntity } from './entities/role.entity';
import { Permission } from './enums/permission.enum';
import { UserRole } from './enums/user-role.enum';
import { ScopeResolutionService } from './scope-resolution.service';

/** Minimal user context required by permission helpers. */
export interface UserContext {
  id: string;
  role: string;
}

/** Roles allowed to approve / reject blood requests and orders. */
const APPROVAL_ROLES = new Set<string>([
  UserRole.ADMIN,
  'blood_bank',
  'blood_bank_staff',
]);

/** Roles allowed to fulfill / deliver orders. */
const FULFILLMENT_ROLES = new Set<string>([
  UserRole.ADMIN,
  UserRole.RIDER,
  'dispatcher',
  'blood_bank',
  'blood_bank_staff',
]);

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
    private readonly userActivityService: UserActivityService,
    private readonly scopeResolutionService: ScopeResolutionService,
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
    actorId?: string,
    context?: {
      ipAddress?: string;
      userAgent?: string;
    },
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
      entity.role = roleEntity;
      return entity;
    });

    roleEntity.permissions = permissionEntities;
    const saved = await this.roleRepository.save(roleEntity);
    await this.invalidateRoleCache(role);
    await this.scopeResolutionService.invalidateScopeCache(role);

    await this.userActivityService.logActivity({
      userId: actorId ?? 'system',
      activityType: ActivityType.PERMISSION_CHANGED,
      description: `Permissions updated for role ${role}`,
      metadata: {
        role,
        permissions,
      },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return saved;
  }

  // ── Shared permission helpers ──────────────────────────────────────────────

  /**
   * Assert that the user holds one of the allowed roles.
   * Throws ForbiddenException if not.
   */
  assertHasRole(
    user: UserContext,
    allowedRoles: UserRole[],
    message?: string,
  ): void {
    const normalized = user.role.toLowerCase();
    const allowed = allowedRoles.map((r) => r.toLowerCase());
    if (!allowed.includes(normalized)) {
      throw new ForbiddenException(
        message ??
          `Role '${user.role}' is not permitted to perform this action.`,
      );
    }
  }

  /**
   * Assert that the actor is either an admin or the resource owner.
   * Throws ForbiddenException otherwise.
   */
  assertIsAdminOrSelf(
    user: UserContext,
    ownerId: string,
    message?: string,
  ): void {
    const isAdmin = user.role.toLowerCase() === UserRole.ADMIN;
    if (!isAdmin && user.id !== ownerId) {
      throw new ForbiddenException(
        message ?? 'You are not allowed to perform this action.',
      );
    }
  }

  /**
   * Assert that the actor's role is allowed to approve or reject requests.
   * Throws ForbiddenException if not.
   */
  assertCanApproveRequest(user: UserContext): void {
    if (!APPROVAL_ROLES.has(user.role.toLowerCase())) {
      throw new ForbiddenException(
        `Role '${user.role}' is not allowed to approve or reject requests.`,
      );
    }
  }

  /**
   * Assert that the actor's role is allowed to fulfill / deliver requests.
   * Throws ForbiddenException if not.
   */
  assertCanFulfillRequest(user: UserContext): void {
    if (!FULFILLMENT_ROLES.has(user.role.toLowerCase())) {
      throw new ForbiddenException(
        `Role '${user.role}' is not allowed to fulfill requests.`,
      );
    }
  }

  /**
   * Assert that the actor is an admin or a blood-bank operator.
   * Used to gate blood-unit registration and status mutations.
   * Throws ForbiddenException if not.
   */
  assertIsBloodBankOrAdmin(user: UserContext): void {
    const normalized = user.role.toLowerCase();
    const isAdmin = normalized === UserRole.ADMIN;
    const isBloodBank =
      normalized.includes('blood') || normalized.includes('bank');
    if (!isAdmin && !isBloodBank) {
      throw new ForbiddenException(
        'Only authorized blood bank accounts can perform this action.',
      );
    }
  }
}
