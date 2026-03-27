import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import Redis from 'ioredis';
import { Repository } from 'typeorm';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { UserEntity } from '../users/entities/user.entity';

import { AuthService } from './auth.service';
import { hashPassword } from './utils/password.util';

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: jest.Mocked<Partial<Repository<UserEntity>>>;

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config = {
        JWT_SECRET: 'test-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        JWT_EXPIRES_IN: '1h',
        JWT_REFRESH_EXPIRES_IN: '7d',
        MAX_FAILED_LOGIN_ATTEMPTS: 5,
        ACCOUNT_LOCK_MINUTES: 15,
      };
      return config[key] || defaultValue;
    }),
  };

  const mockRedis = {
    set: jest.fn(),
    hmset: jest.fn(),
    expire: jest.fn(),
    zadd: jest.fn(),
    zcard: jest.fn(),
    zrange: jest.fn(),
    zrem: jest.fn(),
    del: jest.fn(),
    hset: jest.fn(),
    hgetall: jest.fn(),
    zrevrange: jest.fn(),
  };

  beforeEach(async () => {
    userRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: REDIS_CLIENT,
          useValue: mockRedis,
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: userRepository,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    module.get<JwtService>(JwtService);
    module.get<Redis>(REDIS_CLIENT);

    jest.clearAllMocks();
    mockRedis.zcard.mockResolvedValue(1);
    mockRedis.zrange.mockResolvedValue([]);
    mockRedis.hgetall.mockResolvedValue({});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should return access and refresh tokens', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: 'donor',
        passwordHash: await hashPassword('password'),
        failedLoginAttempts: 0,
        lockedUntil: null,
      } as UserEntity;
      (userRepository.findOne as jest.Mock).mockResolvedValue(user);
      (userRepository.save as jest.Mock).mockResolvedValue(user);

      mockJwtService.sign.mockReturnValueOnce('access-token');
      mockJwtService.sign.mockReturnValueOnce('refresh-token');

      const result = await service.login({
        email: 'test@example.com',
        password: 'password',
      });

      expect(result).toEqual({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      });
      expect(mockJwtService.sign).toHaveBeenCalledTimes(2);
    });

    it('locks account after MAX_FAILED_LOGIN_ATTEMPTS failed attempts', async () => {
      const mockConfigServiceCustom = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'MAX_FAILED_LOGIN_ATTEMPTS') return 3;
          if (key === 'ACCOUNT_LOCK_MINUTES') return 5;
          return mockConfigService.get(key);
        }),
      };
      const moduleCustom = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: JwtService, useValue: mockJwtService },
          { provide: ConfigService, useValue: mockConfigServiceCustom },
          { provide: REDIS_CLIENT, useValue: mockRedis },
          { provide: getRepositoryToken(UserEntity), useValue: userRepository },
        ],
      }).compile();
      const serviceCustom = moduleCustom.get<AuthService>(AuthService);

      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: 'donor',
        passwordHash: await hashPassword('password'),
        failedLoginAttempts: 2,
        lockedUntil: null,
      } as UserEntity;
      (userRepository.findOne as jest.Mock).mockResolvedValue(user);
      (userRepository.save as jest.Mock).mockImplementation(
        async (entity) => entity,
      );

      await expect(
        serviceCustom.login({
          email: 'test@example.com',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(user.failedLoginAttempts).toBe(3);
      expect(user.lockedUntil).toBeInstanceOf(Date);
    });

    it('auto unlocks account after custom ACCOUNT_LOCK_MINUTES and allows login', async () => {
      const mockConfigServiceCustom = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'ACCOUNT_LOCK_MINUTES') return 1;
          return mockConfigService.get(key);
        }),
      };
      const moduleCustom = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: JwtService, useValue: mockJwtService },
          { provide: ConfigService, useValue: mockConfigServiceCustom },
          { provide: REDIS_CLIENT, useValue: mockRedis },
          { provide: getRepositoryToken(UserEntity), useValue: userRepository },
        ],
      }).compile();
      const serviceCustom = moduleCustom.get<AuthService>(AuthService);

      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: 'donor',
        passwordHash: await hashPassword('password'),
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() - 60_000),
      } as UserEntity;
      (userRepository.findOne as jest.Mock).mockResolvedValue(user);
      (userRepository.save as jest.Mock).mockImplementation(
        async (entity) => entity,
      );
      mockJwtService.sign.mockReturnValueOnce('access-token');
      mockJwtService.sign.mockReturnValueOnce('refresh-token');

      const result = await serviceCustom.login({
        email: 'test@example.com',
        password: 'password',
      });

      expect(result.access_token).toBe('access-token');
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockedUntil).toBeNull();
    });

    it('rejects login while account is still locked', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: 'donor',
        passwordHash: await hashPassword('password'),
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 5 * 60 * 1000),
      } as UserEntity;
      (userRepository.findOne as jest.Mock).mockResolvedValue(user);

      await expect(
        service.login({ email: 'test@example.com', password: 'password' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('refreshToken', () => {
    it('should return new tokens when refresh token is valid and unused', async () => {
      const mockPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        role: 'donor',
        sid: 'session-1',
      };

      mockJwtService.verify.mockReturnValue(mockPayload);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.hgetall.mockResolvedValue({
        userId: 'user-123',
      });
      mockJwtService.sign.mockReturnValueOnce('new-access-token');
      mockJwtService.sign.mockReturnValueOnce('new-refresh-token');

      const result = await service.refreshToken('old-refresh-token');

      expect(result).toEqual({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
      });
      expect(mockRedis.set).toHaveBeenCalledWith(
        'auth:refresh-consumed:old-refresh-token',
        '1',
        'EX',
        604800,
        'NX',
      );
    });

    it('should throw UnauthorizedException when token is already used', async () => {
      const mockPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        role: 'donor',
        sid: 'session-1',
      };

      mockJwtService.verify.mockReturnValue(mockPayload);
      mockRedis.set.mockResolvedValue(null);

      await expect(service.refreshToken('used-refresh-token')).rejects.toThrow(
        new UnauthorizedException('INVALID_REFRESH_TOKEN'),
      );
    });

    it('should throw UnauthorizedException when token is invalid', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.refreshToken('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when token is expired', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Token expired');
      });

      await expect(service.refreshToken('expired-token')).rejects.toThrow(
        'Invalid or expired refresh token',
      );
    });
  });

  describe('sessions', () => {
    it('revokes owned session', async () => {
      mockRedis.hgetall.mockResolvedValue({
        userId: 'user-123',
        email: 'test@example.com',
      });

      await service.revokeSession('user-123', 'session-abc');

      expect(mockRedis.hset).toHaveBeenCalled();
      expect(mockRedis.zrem).toHaveBeenCalledWith(
        'auth:user-sessions:user-123',
        'session-abc',
      );
    });
  });

  describe('changePassword', () => {
    it('prevents reusing one of the last 3 passwords', async () => {
      const oldHash = await hashPassword('OldPassword123');
      const newerHash = await hashPassword('NewerPassword123');
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'donor',
        passwordHash: newerHash,
        passwordHistory: [oldHash],
      } as UserEntity;
      (userRepository.findOne as jest.Mock).mockResolvedValue(user);

      await expect(
        service.changePassword(
          'user-123',
          'NewerPassword123',
          'OldPassword123',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
