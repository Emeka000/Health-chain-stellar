import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { RATE_LIMIT_KEY } from '../decorators/rate-limit.decorator';

import { EndpointRateLimitGuard } from './endpoint-rate-limit.guard';

describe('EndpointRateLimitGuard', () => {
  let guard: EndpointRateLimitGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [EndpointRateLimitGuard, Reflector],
    }).compile();

    guard = module.get<EndpointRateLimitGuard>(EndpointRateLimitGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should attach rate limit config to request', async () => {
    const rateLimitConfig = { limit: 5, ttl: 60 };
    jest.spyOn(reflector, 'get').mockReturnValue(rateLimitConfig);

    const mockRequest = { ip: '127.0.0.1', path: '/test', rateLimit: null };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;

    // Mock parent canActivate
    jest
      .spyOn(Object.getPrototypeOf(guard), 'canActivate')
      .mockResolvedValue(true);

    await guard.canActivate(mockContext);

    expect(mockRequest.rateLimit).toEqual(rateLimitConfig);
  });

  it('should handle missing rate limit config', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);

    const mockRequest = { ip: '127.0.0.1', path: '/test' };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;

    jest
      .spyOn(Object.getPrototypeOf(guard), 'canActivate')
      .mockResolvedValue(true);

    await guard.canActivate(mockContext);

    expect(mockRequest.rateLimit).toBeUndefined();
  });
});
