import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { OrdersGateway } from './orders.gateway';

const makeSocket = (overrides: Record<string, unknown> = {}) => ({
  id: 'socket-1',
  join: jest.fn(),
  emit: jest.fn(),
  data: { userId: 'user-1', hospitalIds: ['hosp-1'], role: 'staff' },
  handshake: { auth: { token: 'valid-token' }, headers: {} },
  ...overrides,
});

describe('OrdersGateway — JWT auth & room authorization', () => {
  let gateway: OrdersGateway;
  let jwtService: jest.Mocked<Pick<JwtService, 'verify'>>;
  let mockServer: { use: jest.Mock; to: jest.Mock; emit: jest.Mock };

  beforeEach(async () => {
    jwtService = { verify: jest.fn() };
    mockServer = { use: jest.fn(), to: jest.fn().mockReturnThis(), emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-secret') } },
      ],
    }).compile();

    gateway = module.get(OrdersGateway);
    gateway.server = mockServer as any;
  });

  describe('afterInit — middleware', () => {
    const runMiddleware = (socket: any): Promise<Error | undefined> =>
      new Promise((resolve) => {
        // Capture the middleware registered via server.use
        gateway.afterInit(mockServer as any);
        const middleware = mockServer.use.mock.calls[0][0];
        middleware(socket, (err?: Error) => resolve(err));
      });

    it('rejects connection with no token', async () => {
      const socket = makeSocket({ handshake: { auth: {}, headers: {} } });
      const err = await runMiddleware(socket);
      expect(err?.message).toBe('Authentication token required');
    });

    it('rejects connection with invalid JWT', async () => {
      jwtService.verify.mockImplementation(() => { throw new Error('invalid signature'); });
      const socket = makeSocket();
      const err = await runMiddleware(socket);
      expect(err?.message).toBe('invalid signature');
    });

    it('rejects expired token', async () => {
      jwtService.verify.mockImplementation(() => { throw new Error('jwt expired'); });
      const socket = makeSocket();
      const err = await runMiddleware(socket);
      expect(err?.message).toBe('jwt expired');
    });

    it('accepts valid token and binds identity to socket.data', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-42',
        hospitalIds: ['hosp-A'],
        role: 'staff',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const socket = makeSocket();
      const err = await runMiddleware(socket);
      expect(err).toBeUndefined();
      expect(socket.data.userId).toBe('user-42');
      expect(socket.data.hospitalIds).toEqual(['hosp-A']);
    });
  });

  describe('handleJoinHospital — room authorization', () => {
    it('allows join when hospitalId is in the authenticated scope', () => {
      const socket = makeSocket();
      gateway.handleJoinHospital(socket as any, { hospitalId: 'hosp-1' });
      expect(socket.join).toHaveBeenCalledWith('hospital:hosp-1');
      expect(socket.emit).toHaveBeenCalledWith('joined', {
        hospitalId: 'hosp-1',
        room: 'hospital:hosp-1',
      });
    });

    it('denies cross-hospital room access', () => {
      const socket = makeSocket();
      gateway.handleJoinHospital(socket as any, { hospitalId: 'hosp-evil' });
      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('error', {
        message: 'Not authorized to join this hospital room',
      });
    });

    it('admin can join any hospital room', () => {
      const socket = makeSocket({ data: { userId: 'admin-1', hospitalIds: [], role: 'admin' } });
      gateway.handleJoinHospital(socket as any, { hospitalId: 'any-hosp' });
      expect(socket.join).toHaveBeenCalledWith('hospital:any-hosp');
    });

    it('rejects join when hospitalId is missing', () => {
      const socket = makeSocket();
      gateway.handleJoinHospital(socket as any, {} as any);
      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'hospitalId is required' });
    });

    it('logs audit entry for unauthorized attempt', () => {
      const warnSpy = jest.spyOn(gateway['logger'], 'warn');
      const socket = makeSocket();
      gateway.handleJoinHospital(socket as any, { hospitalId: 'hosp-999' });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unauthorized room join attempt'),
      );
    });
  });

  describe('emitOrderUpdate', () => {
    it('broadcasts only to the correct hospital room', () => {
      gateway.emitOrderUpdate('hosp-1', { id: 'ORD-001' });
      expect(mockServer.to).toHaveBeenCalledWith('hospital:hosp-1');
      expect((mockServer.to as jest.Mock)().emit).toHaveBeenCalledWith(
        'order:updated',
        expect.objectContaining({ id: 'ORD-001' }),
      );
    });
  });
});
