import { HttpException, HttpStatus } from '@nestjs/common';

import { GlobalExceptionFilter } from './global-exception.filter';

const mockWinstonLogger = { warn: jest.fn(), error: jest.fn() };

function buildHost(url = '/test') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { url, correlationId: 'trace-123' };
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
    json,
    status,
  };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter(mockWinstonLogger as any);
  });

  it('maps HttpException to correct status and code', () => {
    const host = buildHost();
    filter.catch(new HttpException('Not found', HttpStatus.NOT_FOUND), host as any);

    expect(host.status).toHaveBeenCalledWith(404);
    expect(host.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'RESOURCE_NOT_FOUND',
        traceId: 'trace-123',
      }),
    );
  });

  it('parses JSON-encoded HttpException body (auth service pattern)', () => {
    const host = buildHost();
    const body = JSON.stringify({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Bad creds' });
    filter.catch(new HttpException(body, HttpStatus.UNAUTHORIZED), host as any);

    expect(host.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Bad creds',
      }),
    );
  });

  it('maps unknown Error to 500 INTERNAL_SERVER_ERROR', () => {
    const host = buildHost();
    filter.catch(new Error('Something broke'), host as any);

    expect(host.status).toHaveBeenCalledWith(500);
    expect(host.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        code: 'INTERNAL_SERVER_ERROR',
      }),
    );
  });

  it('includes traceId and timestamp in every response', () => {
    const host = buildHost('/api/v1/auth/login');
    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host as any);

    expect(host.json).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-123',
        timestamp: expect.any(String),
        path: '/api/v1/auth/login',
      }),
    );
  });

  it('joins array validation messages into a single string', () => {
    const host = buildHost();
    filter.catch(
      new HttpException({ message: ['field is required', 'must be email'], statusCode: 400 }, 400),
      host as any,
    );

    expect(host.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'field is required, must be email',
      }),
    );
  });
});
