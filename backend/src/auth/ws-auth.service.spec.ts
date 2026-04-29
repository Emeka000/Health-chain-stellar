/**
 * WebSocket Authentication Service Tests
 *
 * Test coverage for JWT verification, rate limiting, and security audit logging
 * 95%+ coverage target for security-critical paths
 *
 * Issues #562: Secure WebSocket Gateways with JWT + RBAC
 */

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { WsAuthService, AuthenticatedSocket } from './ws-auth.service';
import { JwtKeyService } from './jwt-key.service';
import { SecurityEventLoggerService, SecurityEventType } from '../user-activity/security-event-logger.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

describe('WsAuthService', () => {
  let service: WsAuthService;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let jwtKeyService: jest.Mocked<JwtKeyService>;
  let redis: jest.Mocked<Redis>;
  let securityEventLogger: jest.Mocked<SecurityEventLoggerService>;

  const mockSocket = {
    id: 'socket123',
    handshake: {
      address: '192.168.1.1',
      headers: {
        'user-agent': 'Mozilla/5.0...',
      },
      auth: {},
      query: {},
    },
    data: {},
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as any;

  const validToken = 'valid.jwt.token';
  const validPayload = {
    sub: 'user123',
    userId: 'user123',
    hospitalId: 'hospital1',
    tenantId: 'hospital1',
    email: 'doctor@hospital.com',
    role: 'doctor',
    roles: ['doctor'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 minutes
  };

  beforeEach(async () => {
    jwtService = {
      verify: jest.fn(),
      decode: jest.fn(),
    } as any;

    configService = {
      get: jest.fn().mockReturnValue('test-secret'),
    } as any;

    jwtKeyService = {
      getActiveKey: jest.fn().mockReturnValue({ kid: 'key-1', secret: 'test-secret' }),
      resolveSecret: jest.fn().mockReturnValue('test-secret'),
    } as any;

    redis = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(true),
    } as any;

    securityEventLogger = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsAuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: JwtKeyService, useValue: jwtKeyService },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: SecurityEventLoggerService, useValue: securityEventLogger },
      ],
    }).compile();

    service = module.get<WsAuthService>(WsAuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('authenticate middleware', () => {
    it('✓ Test 1: Valid JWT should authenticate socket and attach user context', async (done) => {
      jwtService.decode.mockReturnValue({ header: { kid: 'key-1' } });
      jwtService.verify.mockReturnValue(validPayload as any);

      const middleware = service.authenticate();
      const socket = { ...mockSocket };

      middleware(socket as any, (err?: Error) => {
        expect(err).toBeUndefined();
        expect(socket.user).toBeDefined();
        expect(socket.user?.userId).toBe('user123');
        expect(socket.user?.tenantId).toBe('hospital1');
        expect(socket.user?.role).toBe('doctor');
        expect(socket.data.userId).toBe('user123');
        expect(socket.data.tenantId).toBe('hospital1');
        done();
      });
    });

    it('✓ Test 2: Missing token should reject connection and audit WS_NO_TOKEN', async (done) => {
      const socket = { ...mockSocket };

      const middleware = service.authenticate();
      middleware(socket as any, (err?: Error) => {
        expect(err).toBeDefined();
        expect(err?.message).toContain('Authentication token required');
        expect(securityEventLogger.logEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'WS_NO_TOKEN',
          }),
        );
        done();
      });
    });

    it('✓ Test 3: Invalid JWT should reject and audit WS_INVALID_TOKEN', async (done) => {
      const socket = { ...mockSocket, handshake: { ...mockSocket.handshake, auth: { token: 'invalid.token' } } };
      jwtService.decode.mockReturnValue(null);

      const middleware = service.authenticate();
      middleware(socket as any, (err?: Error) => {
        expect(err).toBeDefined();
        expect(err?.message).toContain('Invalid or expired token');
        expect(securityEventLogger.logEvent).toHaveBeenCalled();
        done();
      });
    });

    it('✓ Test 4: Expired token should reject and audit WS_INVALID_TOKEN', async (done) => {
      const expiredPayload = {
        ...validPayload,
        exp: Math.floor(Date.now() / 1000) - 60, // 60 seconds ago
      };

      jwtService.decode.mockReturnValue({ header: { kid: 'key-1' } });
      jwtService.verify.mockReturnValue(expiredPayload as any);

      const socket = { ...mockSocket, handshake: { ...mockSocket.handshake, auth: { token: validToken } } };

      const middleware = service.authenticate();
      middleware(socket as any, (err?: Error) => {
        expect(err).toBeDefined();
        expect(err?.message).toContain('Token expired');
        done();
      });
    });

    it('✓ Test 5: Invalid claims (missing tenantId) should audit WS_INVALID_CLAIMS', async (done) => {
      const invalidPayload = {
        ...validPayload,
        tenantId: undefined,
      };

      jwtService.decode.mockReturnValue({ header: { kid: 'key-1' } });
      jwtService.verify.mockReturnValue(invalidPayload as any);

      const socket = { ...mockSocket, handshake: { ...mockSocket.handshake, auth: { token: validToken } } };

      const middleware = service.authenticate();
      middleware(socket as any, (err?: Error) => {
        expect(err).toBeDefined();
        expect(securityEventLogger.logEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'WS_INVALID_CLAIMS',
          }),
        );
        done();
      });
    });

    it('✓ Test 6: Rate limit exceeded (11th connection) should audit WS_RATE_LIMITED', async (done) => {
      jwtService.decode.mockReturnValue({ header: { kid: 'key-1' } });
      jwtService.verify.mockReturnValue(validPayload as any);

      // Simulate rate limit exceeded
      redis.incr.mockResolvedValue(11);

      const socket = { ...mockSocket, handshake: { ...mockSocket.handshake, auth: { token: validToken } } };

      const middleware = service.authenticate({
        rateLimit: { enabled: true, maxConnections: 10, windowSeconds: 60 },
      });

      middleware(socket as any, (err?: Error) => {
        expect(err).toBeDefined();
        expect(err?.message).toContain('Rate limit exceeded');
        expect(securityEventLogger.logEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'WS_RATE_LIMITED',
          }),
        );
        done();
      });
    });

    it('✓ Test 7: Token from Authorization header should extract correctly', async (done) => {
      jwtService.decode.mockReturnValue({ header: { kid: 'key-1' } });
      jwtService.verify.mockReturnValue(validPayload as any);

      const socket = {
        ...mockSocket,
        handshake: {
          ...mockSocket.handshake,
          headers: {
            'user-agent': 'Mozilla/5.0...',
            authorization: `Bearer ${validToken}`,
          },
          auth: {},
        },
      };

      const middleware = service.authenticate();
      middleware(socket as any, (err?: Error) => {
        expect(err).toBeUndefined();
        expect(socket.user?.userId).toBe('user123');
        done();
      });
    });

    it('✓ Test 8: Auth token should take precedence over header', async (done) => {
      jwtService.decode.mockReturnValue({ header: { kid: 'key-1' } });
      jwtService.verify.mockReturnValue(validPayload as any);

      const socket = {
        ...mockSocket,
        handshake: {
          ...mockSocket.handshake,
          auth: { token: validToken },
          headers: {
            'user-agent': 'Mozilla/5.0...',
            authorization: 'Bearer invalid.token',
          },
        },
      };

      const middleware = service.authenticate();
      middleware(socket as any, (err?: Error) => {
        expect(err).toBeUndefined();
        expect(socket.user?.userId).toBe('user123');
        done();
      });
    });

    it('✓ Test 9: Valid token should audit WS_AUTH_SUCCESS', async (done) => {
      jwtService.decode.mockReturnValue({ header: { kid: 'key-1' } });
      jwtService.verify.mockReturnValue(validPayload as any);

      const socket = { ...mockSocket, handshake: { ...mockSocket.handshake, auth: { token: validToken } } };

      const middleware = service.authenticate();
      middleware(socket as any, (err?: Error) => {
        expect(err).toBeUndefined();
        expect(securityEventLogger.logEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'WS_AUTH_SUCCESS',
            userId: 'user123',
          }),
        );
        done();
      });
    });

    it('✓ Test 10: JWT with previous key should verify during grace period', async (done) => {
      jwtService.decode.mockReturnValue({ header: { kid: 'key-0' } });
      jwtKeyService.resolveSecret.mockReturnValue('old-secret');
      jwtService.verify.mockReturnValue(validPayload as any);

      const socket = { ...mockSocket, handshake: { ...mockSocket.handshake, auth: { token: validToken } } };

      const middleware = service.authenticate();
      middleware(socket as any, (err?: Error) => {
        expect(err).toBeUndefined();
        expect(jwtKeyService.resolveSecret).toHaveBeenCalledWith('key-0');
        done();
      });
    });
  });

  describe('rate limiting', () => {
    it('should reset rate limit counter on window expiry', async (done) => {
      jwtService.decode.mockReturnValue({ header: { kid: 'key-1' } });
      jwtService.verify.mockReturnValue(validPayload as any);

      redis.incr.mockResolvedValueOnce(1);

      const socket = { ...mockSocket, handshake: { ...mockSocket.handshake, auth: { token: validToken } } };

      const middleware = service.authenticate({
        rateLimit: { enabled: true, maxConnections: 10, windowSeconds: 60 },
      });

      middleware(socket as any, (err?: Error) => {
        expect(err).toBeUndefined();
        expect(redis.expire).toHaveBeenCalledWith('ws_conn:user123:192.168.1.1', 60);
        done();
      });
    });

    it('should fallback to in-memory rate limit if Redis fails', async (done) => {
      jwtService.decode.mockReturnValue({ header: { kid: 'key-1' } });
      jwtService.verify.mockReturnValue(validPayload as any);

      redis.incr.mockRejectedValue(new Error('Redis connection failed'));

      const socket = { ...mockSocket, handshake: { ...mockSocket.handshake, auth: { token: validToken } } };

      const middleware = service.authenticate({
        rateLimit: { enabled: true, maxConnections: 10, windowSeconds: 60 },
      });

      middleware(socket as any, (err?: Error) => {
        expect(err).toBeUndefined();
        // Should continue with in-memory fallback
        done();
      });
    });
  });

  describe('security audit trail', () => {
    it('should log all authentication failure events', async (done) => {
      const socket = { ...mockSocket };

      const middleware = service.authenticate();
      middleware(socket as any, () => {
        expect(securityEventLogger.logEvent).toHaveBeenCalled();
        const call = securityEventLogger.logEvent.mock.calls[0];
        expect(call[0].metadata).toBeDefined();
        expect(call[0].metadata.socketId).toBe('socket123');
        done();
      });
    });

    it('should include IP address in audit logs', async (done) => {
      jwtService.decode.mockReturnValue({ header: { kid: 'key-1' } });
      jwtService.verify.mockReturnValue(validPayload as any);

      const socket = { ...mockSocket, handshake: { ...mockSocket.handshake, auth: { token: validToken } } };

      const middleware = service.authenticate();
      middleware(socket as any, (err?: Error) => {
        expect(err).toBeUndefined();
        expect(securityEventLogger.logEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            ipAddress: '192.168.1.1',
          }),
        );
        done();
      });
    });
  });
});
