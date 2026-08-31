/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';

import { NotificationsGateway } from './notifications.gateway';

const makeSocket = (id = 'socket-1') => ({
  id,
  emit: jest.fn(),
  disconnect: jest.fn(),
  join: jest.fn().mockResolvedValue(undefined),
  leave: jest.fn(),
  connected: true,
  on: jest.fn(),
  handshake: {
    auth: { token: 'valid-token' },
    query: {},
    headers: {},
  },
});

const makeServer = () => ({
  to: jest.fn().mockReturnThis(),
  emit: jest.fn(),
});

describe('NotificationsGateway Security & Authentication', () => {
  let gateway: NotificationsGateway;
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    gateway = module.get(NotificationsGateway);
  });

  describe('handleConnection', () => {
    it('rejects connection when no token is provided', async () => {
      const socket = makeSocket();
      socket.handshake.auth = {};
      socket.handshake.query = {};
      socket.handshake.headers = {};

      await gateway.handleConnection(socket as any);

      expect(socket.emit).toHaveBeenCalledWith('error', {
        reason: 'Authentication token required',
      });
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('rejects connection when token is invalid or expired', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.emit).toHaveBeenCalledWith('error', {
        reason: 'Invalid or expired token',
      });
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('rejects connection when token payload lacks sub/userId', async () => {
      jwtService.verifyAsync.mockResolvedValue({ role: 'user' });
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.emit).toHaveBeenCalledWith('error', {
        reason: 'Invalid token payload',
      });
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('authenticates valid token from auth.token and joins recipient room', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-100' });
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.join).toHaveBeenCalledWith('recipient_user-100');
      expect(socket.emit).toHaveBeenCalledWith(
        'connected',
        expect.objectContaining({
          message: 'Authenticated',
          recipientId: 'user-100',
        }),
      );
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('authenticates valid token from query.token', async () => {
      jwtService.verifyAsync.mockResolvedValue({ userId: 'user-200' });
      const socket = makeSocket();
      socket.handshake.auth = {};
      socket.handshake.query = { token: 'query-jwt-token' };

      await gateway.handleConnection(socket as any);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('query-jwt-token');
      expect(socket.join).toHaveBeenCalledWith('recipient_user-200');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('authenticates valid token from authorization header', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-300' });
      const socket = makeSocket();
      socket.handshake.auth = {};
      socket.handshake.query = {};
      socket.handshake.headers = { authorization: 'Bearer header-jwt-token' };

      await gateway.handleConnection(socket as any);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('header-jwt-token');
      expect(socket.join).toHaveBeenCalledWith('recipient_user-300');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('ignores client-supplied query.recipientId and uses authenticated user ID', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'authenticated-user-555',
      });
      const socket = makeSocket();
      // Malicious user attempts to supply victim ID in query
      socket.handshake.query = { recipientId: 'victim-user-999' };

      await gateway.handleConnection(socket as any);

      expect(socket.join).toHaveBeenCalledWith(
        'recipient_authenticated-user-555',
      );
      expect(socket.join).not.toHaveBeenCalledWith('recipient_victim-user-999');
    });
  });

  describe('Event handlers & Notifications', () => {
    it('emits notification.new to recipient room via emitToRecipient', () => {
      const server = makeServer();
      gateway.server = server as any;

      const payload = { id: 'notif-1', message: 'Hello' };
      gateway.emitToRecipient('user-777', payload);

      expect(server.to).toHaveBeenCalledWith('recipient_user-777');
      expect(server.emit).toHaveBeenCalledWith('notification.new', payload);
    });

    it('handles order.status.updated event', () => {
      const server = makeServer();
      gateway.server = server as any;

      gateway.handleOrderStatusUpdated({
        orderId: 'ord-123',
        newStatus: 'DELIVERED',
      });

      expect(server.emit).toHaveBeenCalledWith(
        'blood-request.status-changed',
        expect.objectContaining({
          type: 'ORDER',
          id: 'ord-123',
          newStatus: 'DELIVERED',
        }),
      );
    });

    it('handles blood-request.status.updated event', () => {
      const server = makeServer();
      gateway.server = server as any;

      gateway.handleBloodRequestStatusUpdated({
        requestId: 'br-456',
        newStatus: 'IN_TRANSIT',
      });

      expect(server.emit).toHaveBeenCalledWith(
        'blood-request.status-changed',
        expect.objectContaining({
          type: 'BLOOD_REQUEST',
          id: 'br-456',
          newStatus: 'IN_TRANSIT',
        }),
      );
    });
  });
});
