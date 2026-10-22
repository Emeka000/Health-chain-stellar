import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';

import { TrackingGateway } from './tracking.gateway';

const makeSocket = (id = 'socket-1') => ({
  id,
  emit: jest.fn(),
  disconnect: jest.fn(),
  join: jest.fn(),
  leave: jest.fn(),
  connected: true,
  on: jest.fn(),
  handshake: { auth: { token: 'valid-token' }, query: {} },
});

const makeServer = () => ({
  to: jest.fn().mockReturnThis(),
  emit: jest.fn(),
});

describe('TrackingGateway — authorization & schema validation', () => {
  let gateway: TrackingGateway;
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingGateway,
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    gateway = module.get(TrackingGateway);
  });

  // ---------------------------------------------------------------------------
  // Connection auth
  // ---------------------------------------------------------------------------

  it('rejects connection without token', async () => {
    const socket = makeSocket();
    socket.handshake.auth = {};
    (socket.handshake as any).query = {};
    await gateway.handleConnection(socket as any);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects connection with invalid/expired token', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const socket = makeSocket();
    await gateway.handleConnection(socket as any);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.emit).toHaveBeenCalledWith('error', { reason: 'Invalid or expired token' });
  });

  it('accepts valid token and stores context', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', role: 'user' });
    const socket = makeSocket();
    await gateway.handleConnection(socket as any);
    expect(socket.emit).toHaveBeenCalledWith('connected', expect.objectContaining({ userId: 'user-1' }));
    expect((gateway as any).connectedClients.has('socket-1')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Subscribe authorization
  // ---------------------------------------------------------------------------

  const seedClient = (socketId: string, role: string, riderId?: string) => {
    (gateway as any).connectedClients.set(socketId, {
      userId: 'user-1',
      role,
      riderId,
      rooms: new Set(),
    });
  };

  it('allows any authenticated user to subscribe to a delivery', () => {
    const socket = makeSocket();
    seedClient('socket-1', 'user');
    gateway.handleDeliverySubscribe(socket as any, { deliveryId: 'del-1' });
    expect(socket.join).toHaveBeenCalledWith('delivery:del-1');
  });

  it('rejects subscribe for unauthenticated socket', () => {
    const socket = makeSocket();
    // no client context seeded
    gateway.handleDeliverySubscribe(socket as any, { deliveryId: 'del-1' });
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', { reason: 'Client not authenticated' });
  });

  it('rejects subscribe without deliveryId', () => {
    const socket = makeSocket();
    seedClient('socket-1', 'user');
    gateway.handleDeliverySubscribe(socket as any, {} as any);
    expect(socket.join).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Publish authorization — rider.location
  // ---------------------------------------------------------------------------

  it('allows assigned rider to publish location', () => {
    const socket = makeSocket();
    const server = makeServer();
    (gateway as any).server = server;
    seedClient('socket-1', 'rider', 'rider-1');

    gateway.handleRiderLocation(socket as any, {
      riderId: 'rider-1',
      deliveryId: 'del-1',
      latitude: 6.45,
      longitude: 3.4,
    });

    expect(server.to).toHaveBeenCalledWith('delivery:del-1');
    expect(server.emit).toHaveBeenCalledWith('location.update', expect.objectContaining({ riderId: 'rider-1' }));
  });

  it('blocks a rider from publishing location for another rider\'s delivery', () => {
    const socket = makeSocket();
    const server = makeServer();
    (gateway as any).server = server;
    seedClient('socket-1', 'rider', 'rider-2'); // different rider

    gateway.handleRiderLocation(socket as any, {
      riderId: 'rider-1',
      deliveryId: 'del-1',
      latitude: 6.45,
      longitude: 3.4,
    });

    expect(server.to).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ reason: expect.stringContaining('Not authorized') }));
  });

  it('blocks regular user from publishing location', () => {
    const socket = makeSocket();
    const server = makeServer();
    (gateway as any).server = server;
    seedClient('socket-1', 'user');

    gateway.handleRiderLocation(socket as any, {
      riderId: 'rider-1',
      deliveryId: 'del-1',
      latitude: 6.45,
      longitude: 3.4,
    });

    expect(server.to).not.toHaveBeenCalled();
  });

  it('allows admin to publish location', () => {
    const socket = makeSocket();
    const server = makeServer();
    (gateway as any).server = server;
    seedClient('socket-1', 'admin');

    gateway.handleRiderLocation(socket as any, {
      riderId: 'rider-1',
      deliveryId: 'del-1',
      latitude: 6.45,
      longitude: 3.4,
    });

    expect(server.to).toHaveBeenCalledWith('delivery:del-1');
  });

  // ---------------------------------------------------------------------------
  // Schema / coordinate validation
  // ---------------------------------------------------------------------------

  it('rejects out-of-range latitude', () => {
    const socket = makeSocket();
    const server = makeServer();
    (gateway as any).server = server;
    seedClient('socket-1', 'rider', 'rider-1');

    gateway.handleRiderLocation(socket as any, {
      riderId: 'rider-1',
      deliveryId: 'del-1',
      latitude: 999,
      longitude: 3.4,
    });

    expect(server.to).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', { reason: 'Invalid coordinates' });
  });

  it('rejects invalid delivery status enum', () => {
    const socket = makeSocket();
    const server = makeServer();
    (gateway as any).server = server;
    seedClient('socket-1', 'rider', 'rider-1');

    gateway.handleDeliveryStatus(socket as any, {
      deliveryId: 'del-1',
      status: 'HACKED_STATUS',
      riderId: 'rider-1',
    });

    expect(server.to).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ reason: expect.stringContaining('Invalid status') }));
  });

  it('rejects negative estimatedMinutes in ETA', () => {
    const socket = makeSocket();
    const server = makeServer();
    (gateway as any).server = server;
    seedClient('socket-1', 'admin');

    gateway.handleETABroadcast(socket as any, {
      deliveryId: 'del-1',
      estimatedMinutes: -5,
    });

    expect(server.to).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', { reason: 'Invalid estimatedMinutes' });
  });

  // ---------------------------------------------------------------------------
  // Cross-delivery subscription scope
  // ---------------------------------------------------------------------------

  it('user cannot publish status for a delivery they do not own', () => {
    const socket = makeSocket();
    const server = makeServer();
    (gateway as any).server = server;
    seedClient('socket-1', 'user'); // plain user, not a rider

    gateway.handleDeliveryStatus(socket as any, {
      deliveryId: 'del-99',
      status: 'in_transit',
      riderId: 'rider-99',
    });

    expect(server.to).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ reason: expect.stringContaining('Not authorized') }));
  });
});
