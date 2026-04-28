import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { Server, Socket } from 'socket.io';

import { OrdersGateway } from './orders.gateway';

describe('OrdersGateway', () => {
  let gateway: OrdersGateway;
  let mockServer: Partial<Server>;
  let mockSocket: any;

  const mockJwtService = { verify: jest.fn() };
  const mockConfigService = { get: jest.fn().mockReturnValue('test-secret') };

  beforeEach(async () => {
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      use: jest.fn(),
    };

    mockSocket = {
      id: 'test-socket-id',
      join: jest.fn(),
      emit: jest.fn(),
      data: { userId: 'user-1', hospitalIds: ['hosp-1'], role: 'staff' },
      handshake: {
        auth: { token: 'test-token' },
        headers: {},
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersGateway,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    gateway = module.get<OrdersGateway>(OrdersGateway);
    gateway.server = mockServer as Server;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('should log client connection', () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');
      gateway.handleConnection(mockSocket as Socket);
      expect(logSpy).toHaveBeenCalledWith(
        `WebSocket client connected: ${mockSocket.id}`,
      );
    });
  });

  describe('handleDisconnect', () => {
    it('should log client disconnection', () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');
      gateway.handleDisconnect(mockSocket as Socket);
      expect(logSpy).toHaveBeenCalledWith(
        `WebSocket client disconnected: ${mockSocket.id}`,
      );
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
