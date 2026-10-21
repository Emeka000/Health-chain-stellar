import {
  INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';

import request from 'supertest';

import { Permission } from '../auth/enums/permission.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { BullMQHealthIndicator } from './indicators/bullmq.health-indicator';
import { FirebaseHealthIndicator } from './indicators/firebase.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';
import { SmsHealthIndicator } from './indicators/sms.health-indicator';
import { SorobanRpcHealthIndicator } from './indicators/soroban-rpc.health-indicator';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let app: INestApplication;
  let healthCheckService: { check: jest.Mock };
  let dbIndicator: { pingCheck: jest.Mock };
  let redisIndicator: { isHealthy: jest.Mock };
  let sorobanIndicator: { isHealthy: jest.Mock };
  let bullmqIndicator: { isHealthy: jest.Mock };
  let firebaseIndicator: { isHealthy: jest.Mock };
  let smsIndicator: { isHealthy: jest.Mock };
  let memoryIndicator: { checkHeap: jest.Mock };

  beforeAll(async () => {
    healthCheckService = {
      check: jest.fn(async (checks: Array<() => Promise<unknown>>) => {
        try {
          await Promise.all(checks.map((check) => check()));
        } catch {
          throw new ServiceUnavailableException();
        }
        return { status: 'ok', info: {}, error: {}, details: {} };
      }),
    };
    dbIndicator = {
      pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
    };
    redisIndicator = {
      isHealthy: jest.fn().mockResolvedValue({ redis: { status: 'up' } }),
    };
    sorobanIndicator = {
      isHealthy: jest.fn().mockResolvedValue({ soroban_rpc: { status: 'up' } }),
    };
    bullmqIndicator = {
      isHealthy: jest.fn().mockResolvedValue({ bullmq: { status: 'up' } }),
    };
    firebaseIndicator = {
      isHealthy: jest.fn().mockResolvedValue({ firebase: { status: 'up' } }),
    };
    smsIndicator = {
      isHealthy: jest.fn().mockResolvedValue({ sms: { status: 'up' } }),
    };
    memoryIndicator = {
      checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: dbIndicator },
        { provide: RedisHealthIndicator, useValue: redisIndicator },
        { provide: SorobanRpcHealthIndicator, useValue: sorobanIndicator },
        { provide: BullMQHealthIndicator, useValue: bullmqIndicator },
        { provide: FirebaseHealthIndicator, useValue: firebaseIndicator },
        { provide: SmsHealthIndicator, useValue: smsIndicator },
        { provide: MemoryHealthIndicator, useValue: memoryIndicator },
        {
          provide: JwtAuthGuard,
          useValue: {
            canActivate: (context: any) => {
              const req = context.switchToHttp().getRequest();
              req.user = { role: req.header('x-test-role') ?? 'admin' };
              return true;
            },
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForRole: jest.fn((role: string) =>
              Promise.resolve(
                role === 'admin' ? [Permission.ADMIN_ACCESS] : [],
              ),
            ),
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalGuards(
      app.get(JwtAuthGuard),
      new PermissionsGuard(app.get(Reflector), app.get(PermissionsService)),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    dbIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
    redisIndicator.isHealthy.mockResolvedValue({ redis: { status: 'up' } });
    sorobanIndicator.isHealthy.mockResolvedValue({ soroban_rpc: { status: 'up' } });
    bullmqIndicator.isHealthy.mockResolvedValue({ bullmq: { status: 'up' } });
    firebaseIndicator.isHealthy.mockResolvedValue({ firebase: { status: 'up' } });
    smsIndicator.isHealthy.mockResolvedValue({ sms: { status: 'up' } });
    memoryIndicator.checkHeap.mockResolvedValue({ memory_heap: { status: 'up' } });
  });

  it('returns 200 from liveness without checking dependencies', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'ok' });

    expect(healthCheckService.check).not.toHaveBeenCalled();
    expect(dbIndicator.pingCheck).not.toHaveBeenCalled();
    expect(redisIndicator.isHealthy).not.toHaveBeenCalled();
    expect(sorobanIndicator.isHealthy).not.toHaveBeenCalled();
    expect(bullmqIndicator.isHealthy).not.toHaveBeenCalled();
    expect(firebaseIndicator.isHealthy).not.toHaveBeenCalled();
    expect(smsIndicator.isHealthy).not.toHaveBeenCalled();
  });

  it('returns 503 from readiness when the database check fails', async () => {
    dbIndicator.pingCheck.mockRejectedValueOnce(new Error('database down'));

    await request(app.getHttpServer()).get('/health/ready').expect(503);

    expect(redisIndicator.isHealthy).toHaveBeenCalledWith('redis');
    expect(sorobanIndicator.isHealthy).not.toHaveBeenCalled();
    expect(bullmqIndicator.isHealthy).not.toHaveBeenCalled();
    expect(firebaseIndicator.isHealthy).not.toHaveBeenCalled();
    expect(smsIndicator.isHealthy).not.toHaveBeenCalled();
  });

  it('allows an admin to get the full health details', async () => {
    await request(app.getHttpServer()).get('/health/details').expect(200);

    expect(sorobanIndicator.isHealthy).toHaveBeenCalledWith('soroban_rpc');
    expect(bullmqIndicator.isHealthy).toHaveBeenCalledWith('bullmq');
    expect(firebaseIndicator.isHealthy).toHaveBeenCalledWith('firebase');
    expect(smsIndicator.isHealthy).toHaveBeenCalledWith('sms');
    expect(memoryIndicator.checkHeap).toHaveBeenCalledWith(
      'memory_heap',
      300 * 1024 * 1024,
    );
  });
});
