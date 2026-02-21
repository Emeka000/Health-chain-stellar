import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionsService } from './permissions.service';
import { RoleEntity } from './entities/role.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { Permission } from './enums/permission.enum';
import { UserRole } from './enums/user-role.enum';
import { REDIS_CLIENT } from '../redis/redis.constants';

// ──────────────────────────── test helpers ───────────────────────────────────

function buildRoleEntity(
  role: UserRole,
  permissions: Permission[],
): RoleEntity {
  const entity = new RoleEntity();
  entity.id = `role-${role}`;
  entity.name = role;
  entity.description = `${role} description`;
  entity.createdAt = new Date();
  entity.updatedAt = new Date();
  entity.permissions = permissions.map((p) => {
    const rp = new RolePermissionEntity();
    rp.id = `rp-${p}`;
    rp.permission = p;
    rp.role = entity;
    return rp;
  });
  return entity;
}

// ──────────────────────────────── suite ──────────────────────────────────────

describe('PermissionsService', () => {
  let service: PermissionsService;
  let roleRepo: jest.Mocked<Repository<RoleEntity>>;
  let rolePermissionRepo: jest.Mocked<Repository<RolePermissionEntity>>;
  let redisClient: {
    get: jest.Mock;
    setex: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(async () => {
    redisClient = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        {
          provide: getRepositoryToken(RoleEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RolePermissionEntity),
          useValue: {
            create: jest.fn(),
          },
        },
        {
          provide: REDIS_CLIENT,
          useValue: redisClient,
        },
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
    roleRepo = module.get(getRepositoryToken(RoleEntity));
    rolePermissionRepo = module.get(getRepositoryToken(RolePermissionEntity));
  });

  afterEach(() => jest.clearAllMocks());

  // ── getPermissionsForRole ─────────────────────────────────────────────

  describe('getPermissionsForRole()', () => {
    it('returns cached permissions on Redis hit (no DB call)', async () => {
      const cached = [Permission.VIEW_ORDER, Permission.CREATE_ORDER];
      redisClient.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getPermissionsForRole(UserRole.HOSPITAL);

      expect(result).toEqual(cached);
      expect(roleRepo.findOne).not.toHaveBeenCalled();
    });

    it('queries DB and populates cache on Redis miss', async () => {
      redisClient.get.mockResolvedValue(null);
      redisClient.setex.mockResolvedValue('OK');

      const roleEntity = buildRoleEntity(UserRole.HOSPITAL, [
        Permission.VIEW_ORDER,
        Permission.CREATE_ORDER,
      ]);
      roleRepo.findOne.mockResolvedValue(roleEntity);

      const result = await service.getPermissionsForRole(UserRole.HOSPITAL);

      expect(result).toEqual([Permission.VIEW_ORDER, Permission.CREATE_ORDER]);
      expect(redisClient.setex).toHaveBeenCalledWith(
        `rbac:role:${UserRole.HOSPITAL}`,
        300,
        JSON.stringify([Permission.VIEW_ORDER, Permission.CREATE_ORDER]),
      );
    });

    it('returns empty array when role does not exist in DB', async () => {
      redisClient.get.mockResolvedValue(null);
      roleRepo.findOne.mockResolvedValue(null);

      const result = await service.getPermissionsForRole('nonexistent_role');

      expect(result).toEqual([]);
      expect(redisClient.setex).not.toHaveBeenCalled();
    });

    it('falls back to DB when Redis.get throws', async () => {
      redisClient.get.mockRejectedValue(new Error('Redis connection refused'));
      redisClient.setex.mockResolvedValue('OK');

      const roleEntity = buildRoleEntity(UserRole.ADMIN, [
        Permission.ADMIN_ACCESS,
      ]);
      roleRepo.findOne.mockResolvedValue(roleEntity);

      const result = await service.getPermissionsForRole(UserRole.ADMIN);

      expect(result).toEqual([Permission.ADMIN_ACCESS]);
    });

    it('continues gracefully when Redis.setex throws after DB load', async () => {
      redisClient.get.mockResolvedValue(null);
      redisClient.setex.mockRejectedValue(new Error('Redis write failed'));

      const roleEntity = buildRoleEntity(UserRole.DONOR, [
        Permission.VIEW_ORDER,
      ]);
      roleRepo.findOne.mockResolvedValue(roleEntity);

      const result = await service.getPermissionsForRole(UserRole.DONOR);

      // Should still return the DB result even if caching failed
      expect(result).toEqual([Permission.VIEW_ORDER]);
    });

    it('returns correct permissions for rider role', async () => {
      redisClient.get.mockResolvedValue(null);
      redisClient.setex.mockResolvedValue('OK');

      const riderPermissions = [
        Permission.VIEW_ORDER,
        Permission.UPDATE_ORDER,
        Permission.VIEW_DISPATCH,
        Permission.TRANSFER_CUSTODY,
      ];
      const roleEntity = buildRoleEntity(UserRole.RIDER, riderPermissions);
      roleRepo.findOne.mockResolvedValue(roleEntity);

      const result = await service.getPermissionsForRole(UserRole.RIDER);

      expect(result).toEqual(riderPermissions);
    });

    it('returns all admin permissions from cache', async () => {
      const allPermissions = Object.values(Permission);
      redisClient.get.mockResolvedValue(JSON.stringify(allPermissions));

      const result = await service.getPermissionsForRole(UserRole.ADMIN);

      expect(result.length).toBe(allPermissions.length);
      expect(roleRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ── invalidateRoleCache ───────────────────────────────────────────────

  describe('invalidateRoleCache()', () => {
    it('deletes the correct Redis key', async () => {
      redisClient.del.mockResolvedValue(1);

      await service.invalidateRoleCache(UserRole.HOSPITAL);

      expect(redisClient.del).toHaveBeenCalledWith(
        `rbac:role:${UserRole.HOSPITAL}`,
      );
    });

    it('does not throw when Redis.del fails', async () => {
      redisClient.del.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.invalidateRoleCache(UserRole.HOSPITAL),
      ).resolves.toBeUndefined();
    });
  });

  // ── setPermissionsForRole ─────────────────────────────────────────────

  describe('setPermissionsForRole()', () => {
    it('creates a new role entity when role does not exist', async () => {
      redisClient.get.mockResolvedValue(null);
      redisClient.del.mockResolvedValue(1);

      const newRole = new RoleEntity();
      newRole.id = 'new-role-id';
      newRole.name = UserRole.VENDOR;
      newRole.permissions = [];

      roleRepo.findOne.mockResolvedValue(null);
      roleRepo.create.mockReturnValue(newRole);

      const savedRole = { ...newRole };
      roleRepo.save.mockResolvedValue(savedRole);

      rolePermissionRepo.create.mockImplementation((partial) => {
        const entity = new RolePermissionEntity();
        entity.permission = partial?.permission as Permission;
        return entity;
      });

      const result = await service.setPermissionsForRole(UserRole.VENDOR, [
        Permission.VIEW_INVENTORY,
        Permission.REGISTER_BLOOD_UNIT,
      ]);

      expect(roleRepo.create).toHaveBeenCalledWith({ name: UserRole.VENDOR });
      expect(roleRepo.save).toHaveBeenCalled();
      expect(redisClient.del).toHaveBeenCalledWith(
        `rbac:role:${UserRole.VENDOR}`,
      );
      expect(result).toBeDefined();
    });

    it('updates existing role entity and busts cache', async () => {
      redisClient.del.mockResolvedValue(1);

      const existingRole = buildRoleEntity(UserRole.HOSPITAL, [
        Permission.VIEW_ORDER,
      ]);
      roleRepo.findOne.mockResolvedValue(existingRole);
      roleRepo.save.mockResolvedValue(existingRole);

      rolePermissionRepo.create.mockImplementation((partial) => {
        const entity = new RolePermissionEntity();
        entity.permission = partial?.permission as Permission;
        return entity;
      });

      await service.setPermissionsForRole(UserRole.HOSPITAL, [
        Permission.CREATE_ORDER,
        Permission.VIEW_ORDER,
        Permission.CANCEL_ORDER,
      ]);

      expect(roleRepo.save).toHaveBeenCalled();
      expect(redisClient.del).toHaveBeenCalledWith(
        `rbac:role:${UserRole.HOSPITAL}`,
      );
    });
  });
});
