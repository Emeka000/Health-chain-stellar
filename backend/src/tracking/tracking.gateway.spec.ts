import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { TrackingGateway } from './tracking.gateway';

describe('TrackingGateway', () => {
  let gateway: TrackingGateway;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingGateway,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(),
          },
        },
      ],
    }).compile();

    gateway = module.get<TrackingGateway>(TrackingGateway);
    jwtService = module.get<JwtService>(JwtService);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('should initialize WebSocket server', () => {
    const mockServer = { on: jest.fn() } as any;
    gateway.afterInit(mockServer);
    expect(gateway).toBeDefined();
  });

  describe('Connection Handling', () => {
    let mockSocket: any;

    beforeEach(() => {
      mockSocket = {
        id: 'test-socket-id',
        handshake: {
          auth: { token: 'valid-token' },
        },
        emit: jest.fn(),
        disconnect: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        connected: true,
        on: jest.fn(),
      };
    });

    it('should reject connection without token', async () => {
      mockSocket.handshake.auth = {};
      mockSocket.handshake.query = {};

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
    });

    it('should accept valid JWT token', async () => {
      const mockPayload = { sub: 'user-123' };
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(mockPayload);

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith('connected', expect.objectContaining({
        userId: 'user-123',
      }));
    });

    it('should reject invalid JWT token', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('Invalid token'));

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('Delivery Subscription', () => {
    let mockSocket: any;

    beforeEach(() => {
      mockSocket = {
        id: 'test-socket-id',
        handshake: {
          auth: { token: 'valid-token' },
        },
        emit: jest.fn(),
        disconnect: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        connected: true,
        on: jest.fn(),
      };

      (gateway as any).connectedClients.set('test-socket-id', {
        userId: 'user-123',
        role: 'user',
        rooms: new Set(),
      });

      // Mock authenticated client
    });

    it('should subscribe to delivery room', () => {
      const data = { deliveryId: 'delivery-123' };

      gateway.handleDeliverySubscribe(mockSocket, data);

      expect(mockSocket.join).toHaveBeenCalledWith('delivery:delivery-123');
      expect(mockSocket.emit).toHaveBeenCalledWith('delivery.subscribed', expect.objectContaining({
        deliveryId: 'delivery-123',
      }));
    });

    it('should unsubscribe from delivery room', () => {
      const data = { deliveryId: 'delivery-123' };

      gateway.handleDeliveryUnsubscribe(mockSocket, data);

      expect(mockSocket.leave).toHaveBeenCalledWith('delivery:delivery-123');
      expect(mockSocket.emit).toHaveBeenCalledWith('delivery.unsubscribed', expect.objectContaining({
        deliveryId: 'delivery-123',
      }));
    });

    it('should reject subscription without deliveryId', () => {
      gateway.handleDeliverySubscribe(mockSocket, {});

      expect(mockSocket.emit).toHaveBeenCalledWith('error', { message: 'Missing deliveryId' });
      expect(mockSocket.join).not.toHaveBeenCalled();
    });
  });

  describe('Location Updates', () => {
    let mockSocket: any;
    let mockServer: any;

    beforeEach(() => {
      mockSocket = {
        id: 'test-socket-id',
        emit: jest.fn(),
      };

      mockServer = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };

      (gateway as any).server = mockServer;
      (gateway as any).connectedClients.set('test-socket-id', {
        userId: 'rider-123',
        role: 'rider',
        riderId: 'rider-123',
        rooms: new Set(),
      });
    });

    it('should broadcast location update', () => {
      const data = {
        riderId: 'rider-123',
        deliveryId: 'delivery-456',
        latitude: 40.7128,
        longitude: -74.0060,
        speed: 25.5,
        heading: 90,
      };

      gateway.handleRiderLocation(mockSocket, data);

      expect(mockServer.to).toHaveBeenCalledWith('delivery:delivery-456');
      expect(mockServer.emit).toHaveBeenCalledWith('location.update', expect.objectContaining({
        riderId: 'rider-123',
        latitude: 40.7128,
        longitude: -74.0060,
        speed: 25.5,
        heading: 90,
      }));
    });

    it('should ignore location update without required fields', () => {
      const data = { latitude: 40.7128, longitude: -74.0060 };

      gateway.handleRiderLocation(mockSocket, data);

      expect(mockServer.to).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('deduplicates location updates with the same eventId', () => {
      const data = {
        riderId: 'rider-123',
        deliveryId: 'delivery-456',
        latitude: 40.7128,
        longitude: -74.006,
        eventId: 'loc-1',
      };

      gateway.handleRiderLocation(mockSocket, data);
      gateway.handleRiderLocation(mockSocket, data);

      expect(mockServer.emit).toHaveBeenCalledTimes(1);
    });

    it('buffers out-of-order location updates and emits them in sequence order', () => {
      gateway.handleRiderLocation(mockSocket, {
        riderId: 'rider-123',
        deliveryId: 'delivery-456',
        latitude: 40.7128,
        longitude: -74.006,
        sequenceNumber: 1,
        eventId: 'loc-2',
      });

      expect(mockServer.emit).not.toHaveBeenCalled();

      gateway.handleRiderLocation(mockSocket, {
        riderId: 'rider-123',
        deliveryId: 'delivery-456',
        latitude: 40.713,
        longitude: -74.0058,
        sequenceNumber: 0,
        eventId: 'loc-1',
      });

      expect(mockServer.emit).toHaveBeenNthCalledWith(
        1,
        'location.update',
        expect.objectContaining({ sequenceNumber: 0, eventId: 'loc-1' }),
      );
      expect(mockServer.emit).toHaveBeenNthCalledWith(
        2,
        'location.update',
        expect.objectContaining({ sequenceNumber: 1, eventId: 'loc-2' }),
      );
    });
  });

  describe('Delivery Status Updates', () => {
    let mockSocket: any;
    let mockServer: any;

    beforeEach(() => {
      mockSocket = {
        id: 'test-socket-id',
        emit: jest.fn(),
      };

      mockServer = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };

      (gateway as any).server = mockServer;
      (gateway as any).connectedClients.set('test-socket-id', {
        userId: 'rider-123',
        role: 'rider',
        riderId: 'rider-123',
        rooms: new Set(),
      });
    });

    it('should broadcast delivery status update', () => {
      const data = {
        deliveryId: 'delivery-456',
        status: 'in_transit',
        riderId: 'rider-123',
      };

      gateway.handleDeliveryStatus(mockSocket, data);

      expect(mockServer.to).toHaveBeenCalledWith('delivery:delivery-456');
      expect(mockServer.emit).toHaveBeenCalledWith('delivery.status.updated', expect.objectContaining({
        deliveryId: 'delivery-456',
        status: 'in_transit',
        riderId: 'rider-123',
      }));
    });
  });

  describe('ETA Updates', () => {
    let mockSocket: any;
    let mockServer: any;

    beforeEach(() => {
      mockSocket = {
        id: 'test-socket-id',
        emit: jest.fn(),
      };

      mockServer = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };

      (gateway as any).server = mockServer;
      (gateway as any).connectedClients.set('test-socket-id', {
        userId: 'admin-1',
        role: 'admin',
        rooms: new Set(),
      });
    });

    it('should broadcast ETA update', () => {
      const data = {
        deliveryId: 'delivery-456',
        estimatedMinutes: 15,
        distanceKm: 2.5,
      };

      gateway.handleETABroadcast(mockSocket, data);

      expect(mockServer.to).toHaveBeenCalledWith('delivery:delivery-456');
      expect(mockServer.emit).toHaveBeenCalledWith('delivery.eta.updated', expect.objectContaining({
        deliveryId: 'delivery-456',
        estimatedMinutes: 15,
        distanceKm: 2.5,
      }));
    });
  });

  describe('Public Methods', () => {
    let mockServer: any;

    beforeEach(() => {
      mockServer = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };

      (gateway as any).server = mockServer;
    });

    it('should emit location update via public method', () => {
      const payload = {
        riderId: 'rider-123',
        deliveryId: 'delivery-456',
        latitude: 40.7128,
        longitude: -74.0060,
      };

      gateway.emitLocationUpdate(payload);

      expect(mockServer.to).toHaveBeenCalledWith('delivery:delivery-456');
      expect(mockServer.emit).toHaveBeenCalledWith('location.update', expect.objectContaining(payload));
    });

    it('should emit delivery status update via public method', () => {
      const payload = {
        deliveryId: 'delivery-456',
        status: 'delivered',
      };

      gateway.emitDeliveryStatusUpdate(payload);

      expect(mockServer.to).toHaveBeenCalledWith('delivery:delivery-456');
      expect(mockServer.emit).toHaveBeenCalledWith('delivery.status.updated', expect.objectContaining(payload));
    });

    it('should emit ETA update via public method', () => {
      const payload = {
        deliveryId: 'delivery-456',
        estimatedMinutes: 10,
      };

      gateway.emitETAUpdate(payload);

      expect(mockServer.to).toHaveBeenCalledWith('delivery:delivery-456');
      expect(mockServer.emit).toHaveBeenCalledWith('delivery.eta.updated', expect.objectContaining(payload));
    });
  });
});
