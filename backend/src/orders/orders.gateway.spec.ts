/**
 * Orders Gateway RBAC Tests — Issue #562
 *
 * Comprehensive test coverage for WebSocket role-based access control,
 * tenant isolation, and security audit logging
 */

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { Server, Socket } from 'socket.io';

import { OrdersGateway } from './orders.gateway';
import { WsAuthService, AuthenticatedSocket } from '../auth/ws-auth.service';
import { SecurityEventLoggerService } from '../user-activity/security-event-logger.service';

describe('OrdersGateway RBAC Tests', () => {
  let gateway: OrdersGateway;
  let wsAuthService: jest.Mocked<WsAuthService>;
  let securityEventLogger: jest.Mocked<SecurityEventLoggerService>;

  const mockServer = {
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    use: jest.fn(),
  } as any;

  const createMockSocket = (
    userId: string,
    tenantId: string,
    role: string,
    hospitalIds: string[] = [],
  ): AuthenticatedSocket => ({
    id: `socket-${userId}`,
    handshake: {
      address: '192.168.1.1',
      headers: {},
      auth: {},
      query: {},
    } as any,
    data: { userId, tenantId, role, hospitalIds },
    user: {
      userId,
      tenantId,
      role,
      roles: [role],
      email: `${role}@hospital.com`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 15 * 60,
    },
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
    connected: true,
  } as any);

  beforeEach(async () => {
    wsAuthService = {
      authenticate: jest.fn().mockReturnValue(() => {}),
    } as any;

    securityEventLogger = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersGateway,
        { provide: WsAuthService, useValue: wsAuthService },
        { provide: SecurityEventLoggerService, useValue: securityEventLogger },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: {} },
      ],
    }).compile();

    gateway = module.get<OrdersGateway>(OrdersGateway);
    gateway.server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should be defined', () => {
      expect(gateway).toBeDefined();
    });

    it('should initialize with WsAuthService middleware', () => {
      gateway.afterInit(mockServer);
      expect(mockServer.use).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('Connection Management', () => {
    it('✓ should log authenticated client connection', () => {
      const socket = createMockSocket('user1', 'hospital1', 'doctor', ['hospital1']);
      const logSpy = jest.spyOn(gateway['logger'], 'log');

      gateway.handleConnection(socket);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Orders client connected:'),
      );
    });

    it('✓ should log client disconnection', () => {
      const socket = createMockSocket('user1', 'hospital1', 'doctor', ['hospital1']);
      const logSpy = jest.spyOn(gateway['logger'], 'log');

      gateway.handleDisconnection(socket);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Orders client disconnected'),
      );
    });
  });

  describe('handleJoinHospital — Role-Based Access Control', () => {
    it('✓ Test 1: Doctor should join orders channel', async () => {
      const socket = createMockSocket('doctor1', 'hospital1', 'doctor', ['hospital1']);

      await gateway.handleJoinHospital(socket, { hospitalId: 'hospital1' });

      expect(socket.join).toHaveBeenCalledWith('orders:hospital1');
      expect(socket.emit).toHaveBeenCalledWith(
        'joined_channel',
        expect.objectContaining({ channel: 'orders:hospital1' }),
      );
    });

    it('✓ Test 2: Admin should join any hospital orders', async () => {
      const socket = createMockSocket('admin1', 'hospital1', 'admin', []);

      await gateway.handleJoinHospital(socket, { hospitalId: 'hospital2' });

      expect(socket.join).toHaveBeenCalledWith('orders:hospital2');
    });

    it('✗ Test 3: Patient should NOT join (insufficient role)', async () => {
      const socket = createMockSocket('patient1', 'hospital1', 'patient', []);

      await gateway.handleJoinHospital(socket, { hospitalId: 'hospital1' });

      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('auth_error', expect.stringContaining('Insufficient permissions'));
      expect(securityEventLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            event: 'WS_PRIVILEGE_VIOLATION',
          }),
        }),
      );
    });

    it('✗ Test 4: Tenant escape attempt audited', async () => {
      const socket = createMockSocket('doctor1', 'hospital1', 'doctor', ['hospital1']);

      await gateway.handleJoinHospital(socket, { hospitalId: 'hospital2' });

      expect(socket.join).not.toHaveBeenCalled();
      expect(securityEventLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            event: 'WS_TENANT_ESCAPE_ATTEMPT',
          }),
        }),
      );
    });

    it('✓ Test 5: Dispatcher should join orders', async () => {
      const socket = createMockSocket('dispatch1', 'hospital1', 'dispatcher', ['hospital1']);

      await gateway.handleJoinHospital(socket, { hospitalId: 'hospital1' });

      expect(socket.join).toHaveBeenCalledWith('orders:hospital1');
    });
  });

  describe('handleJoinDispatch — Privileged Access', () => {
    it('✓ Test 6: Dispatcher can join dispatch', async () => {
      const socket = createMockSocket('dispatch1', 'hospital1', 'dispatcher', ['hospital1']);

      await gateway.handleJoinDispatch(socket);

      expect(socket.join).toHaveBeenCalledWith('dispatch:hospital1');
    });

    it('✓ Test 7: Admin can join dispatch', async () => {
      const socket = createMockSocket('admin1', 'hospital1', 'admin');

      await gateway.handleJoinDispatch(socket);

      expect(socket.join).toHaveBeenCalledWith('dispatch:hospital1');
    });

    it('✗ Test 8: Doctor cannot join dispatch', async () => {
      const socket = createMockSocket('doctor1', 'hospital1', 'doctor', ['hospital1']);

      await gateway.handleJoinDispatch(socket);

      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('auth_error', expect.stringContaining('dispatch access restricted'));
      expect(securityEventLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            resource: 'dispatch',
            event: 'WS_PRIVILEGE_VIOLATION',
          }),
        }),
      );
    });

    it('✗ Test 9: Patient cannot join dispatch', async () => {
      const socket = createMockSocket('patient1', 'hospital1', 'patient');

      await gateway.handleJoinDispatch(socket);

      expect(socket.join).not.toHaveBeenCalled();
    });
  });

  describe('Token Refresh', () => {
    it('✓ Test 10: Token refresh should succeed with valid refresh token', async () => {
      const socket = createMockSocket('user1', 'hospital1', 'doctor', ['hospital1']);

      await gateway.handleRefreshToken(socket, { refreshToken: 'valid.refresh' });

      expect(socket.emit).toHaveBeenCalledWith(
        'token_refreshed',
        expect.objectContaining({ status: 'success' }),
      );
    });

    it('should reject refresh without authentication', async () => {
      const socket = createMockSocket('user1', 'hospital1', 'doctor');
      socket.user = undefined;

      await gateway.handleRefreshToken(socket, { refreshToken: 'token' });

      expect(socket.emit).toHaveBeenCalledWith('auth_error', expect.stringContaining('not authenticated'));
    });
  });

  describe('Tenant Isolation', () => {
    it('should use tenant-scoped channel naming', async () => {
      const socket = createMockSocket('doctor1', 'hospital1', 'doctor', ['hospital1']);

      await gateway.handleJoinHospital(socket, { hospitalId: 'hospital1' });

      const call = socket.join.mock.calls[0];
      expect(call[0]).toMatch(/^orders:hospital1$/);
    });
  });

  describe('handleJoinHospital — authorization', () => {
    it('allows join when hospitalId is in the authenticated identity scope', () => {
      gateway.handleJoinHospital(mockSocket, { hospitalId: 'hosp-1' });
      expect(mockSocket.join).toHaveBeenCalledWith('hospital:hosp-1');
      expect(mockSocket.emit).toHaveBeenCalledWith('joined', {
        hospitalId: 'hosp-1',
        room: 'hospital:hosp-1',
      });
    });

    it('rejects join when hospitalId is NOT in the authenticated identity scope', () => {
      gateway.handleJoinHospital(mockSocket, { hospitalId: 'hosp-999' });
      expect(mockSocket.join).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Not authorized to join this hospital room',
      });
    });

    it('allows admin to join any hospital room', () => {
      mockSocket.data.role = 'admin';
      mockSocket.data.hospitalIds = [];
      gateway.handleJoinHospital(mockSocket, { hospitalId: 'any-hosp' });
      expect(mockSocket.join).toHaveBeenCalledWith('hospital:any-hosp');
    });

    it('rejects join and logs audit entry for unauthorized attempt', () => {
      const warnSpy = jest.spyOn(gateway['logger'], 'warn');
      gateway.handleJoinHospital(mockSocket, { hospitalId: 'hosp-evil' });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unauthorized room join attempt'),
      );
    });
  });

  describe('emitOrderStatusUpdated', () => {
    it('should broadcast status update event', () => {
      gateway['emitOrderUpdate']('hosp-1', { id: 'ORD-001' });
      expect(mockServer.to).toHaveBeenCalledWith('hospital:hosp-1');
      expect((mockServer.to as jest.Mock)().emit).toHaveBeenCalledWith(
        'order:updated',
        expect.objectContaining({ id: 'ORD-001' }),
      );
    });
  });
});
