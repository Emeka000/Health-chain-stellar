import { Test } from '@nestjs/testing';

import { Request, Response } from 'express';

import { CorrelationIdMiddleware } from './correlation-id.middleware';

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CorrelationIdMiddleware],
    }).compile();

    middleware = module.get<CorrelationIdMiddleware>(CorrelationIdMiddleware);
  });

  it('should generate correlation ID if not provided', () => {
    const req = { headers: {} } as Request;
    const res = { setHeader: jest.fn() } as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.correlationId).toBeDefined();
    expect(res.setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      req.correlationId,
    );
    expect(next).toHaveBeenCalled();
  });

  it('should use provided correlation ID from header', () => {
    const providedId = 'test-correlation-id';
    const req = { headers: { 'x-correlation-id': providedId } } as Request;
    const res = { setHeader: jest.fn() } as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.correlationId).toBe(providedId);
    expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', providedId);
    expect(next).toHaveBeenCalled();
  });
});
