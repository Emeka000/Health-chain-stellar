import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AuditLogService } from '../common/audit/audit-log.service';
import { OrderEntity } from '../orders/entities/order.entity';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { UserEntity } from '../users/entities/user.entity';

import { RetentionPolicyService } from './retention-policy.service';

const mockRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    whereInIds: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
  })),
});

describe('RetentionPolicyService', () => {
  let service: RetentionPolicyService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RetentionPolicyService,
        { provide: getRepositoryToken(UserEntity), useValue: mockRepo() },
        { provide: getRepositoryToken(OrderEntity), useValue: mockRepo() },
        {
          provide: REDIS_CLIENT,
          useValue: {
            scanStream: jest.fn(() => ({
              [Symbol.asyncIterator]: async function* () {
                yield [];
              },
            })),
            get: jest.fn(),
            del: jest.fn(),
          },
        },
        { provide: AuditLogService, useValue: { insert: jest.fn() } },
        {
          provide: DataSource,
          useValue: { transaction: jest.fn((cb) => cb({ update: jest.fn() })) },
        },
      ],
    }).compile();

    service = module.get(RetentionPolicyService);
  });

  it('schedules retention deletions on the first Sunday of each month at 02:00 UTC', () => {
    const cronMetadata = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      RetentionPolicyService.prototype.runScheduled,
    );

    expect(cronMetadata).toEqual(
      expect.objectContaining({
        cronTime: '0 2 1-7 * 0',
        name: 'retention-policy-job',
        timeZone: 'UTC',
      }),
    );
  });

  it('run() returns dry-run counts without mutating data', async () => {
    const result = await service.run(true);

    expect(result).toEqual({
      usersAnonymised: 0,
      ussdSessionsDeleted: 0,
      orderPatientIdsStripped: 0,
      dryRun: true,
    });
  });
});
