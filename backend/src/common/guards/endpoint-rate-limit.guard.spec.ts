import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  seconds,
  ThrottlerException,
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorageService,
} from '@nestjs/throttler';

import { RateLimitConfig } from '../decorators/rate-limit.decorator';

import { EndpointRateLimitGuard } from './endpoint-rate-limit.guard';

/**
 * These tests assert on throttling behaviour — that requests are actually
 * rejected once the decorated limit is exceeded — rather than on the guard
 * having stashed a config object somewhere. The previous version asserted the
 * latter, which passed even though the decorator changed nothing.
 */
describe('EndpointRateLimitGuard', () => {
  const GLOBAL_LIMIT = 100;
  const GLOBAL_TTL = seconds(60);

  let guard: EndpointRateLimitGuard;
  let reflector: Reflector;
  let storage: ThrottlerStorageService;

  const options: ThrottlerModuleOptions = {
    throttlers: [{ name: 'default', limit: GLOBAL_LIMIT, ttl: GLOBAL_TTL }],
  };

  const handlerRef = function handler() {};
  const classRef = class Controller {};

  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ ip: '127.0.0.1', path: '/test', headers: {} }),
      getResponse: () => ({ header: jest.fn() }),
    }),
    getHandler: () => handlerRef,
    getClass: () => classRef,
  } as unknown as ExecutionContext;

  /** Drive one request through the guard's throttling path. */
  const hit = (): Promise<boolean> => {
    const requestProps: ThrottlerRequest = {
      context,
      limit: GLOBAL_LIMIT,
      ttl: GLOBAL_TTL,
      throttler: { name: 'default', limit: GLOBAL_LIMIT, ttl: GLOBAL_TTL },
      blockDuration: GLOBAL_TTL,
      getTracker: () => Promise.resolve('127.0.0.1'),
      generateKey: () => 'endpoint-rate-limit-spec',
    };

    return (
      guard as unknown as {
        handleRequest(props: ThrottlerRequest): Promise<boolean>;
      }
    ).handleRequest(requestProps);
  };

  const withRateLimit = (config?: RateLimitConfig) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(config);
  };

  beforeEach(async () => {
    storage = new ThrottlerStorageService();
    reflector = new Reflector();
    guard = new EndpointRateLimitGuard(options, storage, reflector);
    await guard.onModuleInit();
  });

  afterEach(() => {
    storage.onApplicationShutdown();
    jest.restoreAllMocks();
  });

  it('rejects requests once the decorated limit is exceeded', async () => {
    withRateLimit({ limit: 2, ttl: 60 });

    await expect(hit()).resolves.toBe(true);
    await expect(hit()).resolves.toBe(true);

    // Third request is over the decorated limit of 2, even though the global
    // throttler would still allow 97 more.
    await expect(hit()).rejects.toThrow(ThrottlerException);
  });

  it('applies the decorated limit rather than the global one', async () => {
    withRateLimit({ limit: 1, ttl: 60 });

    await expect(hit()).resolves.toBe(true);
    await expect(hit()).rejects.toThrow(ThrottlerException);
  });

  it('converts the decorated ttl from seconds to milliseconds', async () => {
    withRateLimit({ limit: 1, ttl: 60 });
    const increment = jest.spyOn(storage, 'increment');

    await hit();

    expect(increment).toHaveBeenCalledWith(
      expect.any(String),
      seconds(60),
      1,
      expect.any(Number),
      'default',
    );
  });

  it('falls through to the global limit when the endpoint is not decorated', async () => {
    withRateLimit(undefined);

    for (let i = 0; i < 5; i++) {
      await expect(hit()).resolves.toBe(true);
    }
  });
});
