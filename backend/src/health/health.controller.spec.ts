import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator, MemoryHealthIndicator } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { SorobanRpcHealthIndicator } from './indicators/soroban-rpc.health-indicator';
import { BullMQHealthIndicator } from './indicators/bullmq.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: { check: jest.Mock };
  let redisIndicator: { isHealthy: jest.Mock };

  beforeEach(async () => {
    healthCheckService = {
      check: jest.fn(async (checks: Array<() => unknown>) => {
        await Promise.all(checks.map((check) => check()));
        return { status: 'ok', info: {}, error: {}, details: {} };
      }),
    };
    redisIndicator = { isHealthy: jest.fn().mockResolvedValue({ redis: { status: 'up' } }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck: jest.fn() } },
        { provide: RedisHealthIndicator, useValue: redisIndicator },
        {
          provide: SorobanRpcHealthIndicator,
          useValue: { isHealthy: jest.fn().mockResolvedValue({ soroban_rpc: { status: 'up' } }) },
        },
        {
          provide: BullMQHealthIndicator,
          useValue: { isHealthy: jest.fn().mockResolvedValue({ bullmq: { status: 'up' } }) },
        },
        { provide: MemoryHealthIndicator, useValue: { checkHeap: jest.fn() } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('includes a Redis check in the public /health response', async () => {
    await controller.check();

    expect(redisIndicator.isHealthy).toHaveBeenCalledWith('redis');
  });

  it('includes a Redis check in the admin /health/details response', async () => {
    await controller.details();

    expect(redisIndicator.isHealthy).toHaveBeenCalledWith('redis');
  });
});
