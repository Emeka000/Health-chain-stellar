import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyService } from './idempotency.service';
import { REDIS_CLIENT } from '../../redis/redis.constants';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let redis: { set: jest.Mock };

  beforeEach(async () => {
    redis = { set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
  });

  it('returns true the first time and false for the same key', async () => {
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await expect(service.checkAndSetIdempotencyKey('key-1')).resolves.toBe(true);
    await expect(service.checkAndSetIdempotencyKey('key-1')).resolves.toBe(false);

    expect(redis.set).toHaveBeenNthCalledWith(1, 'key-1', '1', 'EX', expect.any(Number), 'NX');
    expect(redis.set).toHaveBeenNthCalledWith(2, 'key-1', '1', 'EX', expect.any(Number), 'NX');
  });
});
