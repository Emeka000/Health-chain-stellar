import { Test, TestingModule } from '@nestjs/testing';

import { Server, Socket } from 'socket.io';

import { OrdersGateway } from './gateways/orders.gateway';

describe('OrdersGateway', () => {
  let gateway: OrdersGateway;
  let mockServer: Partial<Server>;
  let mockSocket: Partial<Socket>;

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
      handshake: {
        auth: { token: 'test-token' },
        headers: {},
      } as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [OrdersGateway],
    }).compile();

    gateway = module.get<OrdersGateway>(OrdersGateway);
    gateway.server = mockServer as Server;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('afterInit', () => {
    it('should initialize gateway', () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');
      gateway.afterInit(mockServer as Server);
      expect(logSpy).toHaveBeenCalledWith(
        'OrdersGateway WebSocket server initialised',
      );
    });
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

  describe('emitOrderStatusUpdated', () => {
    it('should broadcast status update event', () => {
      gateway.emitOrderStatusUpdated({
        orderId: 'ORD-001',
        previousStatus: 'PENDING',
        newStatus: 'CONFIRMED',
        eventType: 'ORDER_CONFIRMED',
        actorId: 'actor-1',
        timestamp: new Date(),
      });

      expect(mockServer.emit).toHaveBeenCalledWith(
        'order.status.updated',
        expect.objectContaining({
          orderId: 'ORD-001',
          previousStatus: 'PENDING',
          newStatus: 'CONFIRMED',
        }),
      );
    });

    it('should log broadcast action', () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');
      gateway.emitOrderStatusUpdated({
        orderId: 'ORD-001',
        previousStatus: 'CONFIRMED',
        newStatus: 'DELIVERED',
        eventType: 'ORDER_DELIVERED',
        timestamp: new Date(),
      });

      expect(logSpy).toHaveBeenCalledWith(
        '[WS] order.status.updated — orderId=ORD-001 CONFIRMED → DELIVERED',
      );
    });
  });
});
