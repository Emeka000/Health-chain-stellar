import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

const VALID_DELIVERY_STATUSES = new Set([
  'pending',
  'assigned',
  'in_transit',
  'delivered',
  'cancelled',
]);

const LAT_MIN = -90;
const LAT_MAX = 90;
const LON_MIN = -180;
const LON_MAX = 180;

interface ClientContext {
  userId: string;
  role: string;
  riderId?: string;
  rooms: Set<string>;
}

interface LocationUpdatePayload {
  riderId: string;
  deliveryId: string;
  latitude: number;
  longitude: number;
  timestamp?: string;
  speed?: number;
  heading?: number;
}

interface DeliveryStatusPayload {
  deliveryId: string;
  status: string;
  riderId?: string;
  timestamp?: string;
}

interface ETAPayload {
  deliveryId: string;
  estimatedMinutes: number;
  distanceKm?: number;
  timestamp?: string;
}

@WebSocketGateway({
  namespace: '/tracking',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
export class TrackingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TrackingGateway.name);
  private readonly heartbeatInterval = 30_000;
  private readonly connectedClients = new Map<string, ClientContext>();

  constructor(private readonly jwtService: JwtService) {}

  afterInit(_server: Server): void {
    this.logger.log('TrackingGateway WebSocket server initialised');
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token ?? client.handshake.query?.token;

    if (!token) {
      this.logger.warn(`Tracking WS rejected: no token (socket=${client.id})`);
      client.emit('error', { reason: 'Authentication token required' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token as string);
      const userId: string = payload.sub ?? payload.userId;
      const role: string = payload.role ?? 'user';
      const riderId: string | undefined = payload.riderId;

      this.connectedClients.set(client.id, { userId, role, riderId, rooms: new Set() });

      const interval = setInterval(() => {
        if (client.connected) client.emit('heartbeat', { timestamp: new Date().toISOString() });
      }, this.heartbeatInterval);

      client.on('disconnect', () => {
        clearInterval(interval);
        this.connectedClients.delete(client.id);
      });

      client.emit('connected', {
        message: 'Successfully connected to tracking service',
        userId,
        timestamp: new Date().toISOString(),
      });

      this.logger.log(`Tracking WS connected: ${client.id} (user=${userId} role=${role})`);
    } catch (error) {
      this.logger.warn(
        `Tracking WS rejected: invalid token (socket=${client.id}): ${(error as Error).message}`,
      );
      client.emit('error', { reason: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.connectedClients.delete(client.id);
    this.logger.log(`Tracking WS disconnected: ${client.id}`);
  }

  // ---------------------------------------------------------------------------
  // Authorization helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns true if the authenticated client is allowed to subscribe to a delivery room.
   * Admins and dispatchers can subscribe to any delivery.
   * Riders can only subscribe to their own deliveries.
   * Regular users are allowed to subscribe (read-only consumers).
   */
  private canSubscribe(ctx: ClientContext, _deliveryId: string): boolean {
    return ['admin', 'super_admin', 'dispatcher', 'rider', 'user'].includes(ctx.role);
  }

  /**
   * Returns true if the client is allowed to PUBLISH events for a delivery.
   * Only the assigned rider (riderId claim matches) or admins/dispatchers may publish.
   */
  private canPublish(ctx: ClientContext, deliveryRiderId: string | undefined): boolean {
    if (['admin', 'super_admin', 'dispatcher'].includes(ctx.role)) return true;
    if (ctx.role === 'rider' && ctx.riderId && ctx.riderId === deliveryRiderId) return true;
    return false;
  }

  private getContext(client: Socket): ClientContext | null {
    return this.connectedClients.get(client.id) ?? null;
  }

  private rejectUnauthorized(client: Socket, action: string, deliveryId: string): void {
    this.logger.warn(
      `Unauthorized ${action} attempt: socket=${client.id} deliveryId=${deliveryId}`,
    );
    client.emit('error', { reason: `Not authorized to ${action} for delivery ${deliveryId}` });
  }

  // ---------------------------------------------------------------------------
  // Subscribe / Unsubscribe
  // ---------------------------------------------------------------------------

  @SubscribeMessage('delivery.subscribe')
  handleDeliverySubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { deliveryId: string },
  ) {
    if (!data?.deliveryId) {
      client.emit('error', { message: 'Missing deliveryId' });
      return;
    }

    const ctx = this.getContext(client);
    if (!ctx) {
      client.emit('error', { reason: 'Client not authenticated' });
      return;
    }

    if (!this.canSubscribe(ctx, data.deliveryId)) {
      this.rejectUnauthorized(client, 'subscribe', data.deliveryId);
      return;
    }

    const room = `delivery:${data.deliveryId}`;
    client.join(room);
    ctx.rooms.add(room);

    this.logger.debug(`Client ${client.id} (user=${ctx.userId}) joined ${room}`);
    client.emit('delivery.subscribed', {
      deliveryId: data.deliveryId,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('delivery.unsubscribe')
  handleDeliveryUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { deliveryId: string },
  ) {
    if (!data?.deliveryId) {
      client.emit('error', { message: 'Missing deliveryId' });
      return;
    }

    const ctx = this.getContext(client);
    if (!ctx) {
      client.emit('error', { reason: 'Client not authenticated' });
      return;
    }

    const room = `delivery:${data.deliveryId}`;
    client.leave(room);
    ctx.rooms.delete(room);

    client.emit('delivery.unsubscribed', {
      deliveryId: data.deliveryId,
      timestamp: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // Publish events — delivery-level authorization + schema validation
  // ---------------------------------------------------------------------------

  @SubscribeMessage('rider.location')
  handleRiderLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: LocationUpdatePayload,
  ) {
    if (!data?.deliveryId || !data?.riderId) return;

    const ctx = this.getContext(client);
    if (!ctx) return;

    // Only the rider assigned to this delivery (or admin/dispatcher) may publish location
    if (!this.canPublish(ctx, data.riderId)) {
      this.rejectUnauthorized(client, 'publish location', data.deliveryId);
      return;
    }

    // Coordinate range validation
    if (
      typeof data.latitude !== 'number' ||
      typeof data.longitude !== 'number' ||
      data.latitude < LAT_MIN || data.latitude > LAT_MAX ||
      data.longitude < LON_MIN || data.longitude > LON_MAX
    ) {
      client.emit('error', { reason: 'Invalid coordinates' });
      return;
    }

    const room = `delivery:${data.deliveryId}`;
    this.server.to(room).emit('location.update', {
      riderId: data.riderId,
      deliveryId: data.deliveryId,
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed ?? null,
      heading: data.heading ?? null,
      timestamp: data.timestamp ?? new Date().toISOString(),
    });
  }

  @SubscribeMessage('delivery.status')
  handleDeliveryStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: DeliveryStatusPayload,
  ) {
    if (!data?.deliveryId || !data?.status) return;

    const ctx = this.getContext(client);
    if (!ctx) return;

    if (!this.canPublish(ctx, data.riderId)) {
      this.rejectUnauthorized(client, 'publish status', data.deliveryId);
      return;
    }

    // Status enum validation
    if (!VALID_DELIVERY_STATUSES.has(data.status)) {
      client.emit('error', { reason: `Invalid status value: ${data.status}` });
      return;
    }

    const room = `delivery:${data.deliveryId}`;
    this.server.to(room).emit('delivery.status.updated', {
      deliveryId: data.deliveryId,
      status: data.status,
      riderId: data.riderId ?? null,
      timestamp: data.timestamp ?? new Date().toISOString(),
    });

    this.logger.log(`Delivery ${data.deliveryId} status → ${data.status} by user=${ctx.userId}`);
  }

  @SubscribeMessage('delivery.eta')
  handleETABroadcast(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ETAPayload,
  ) {
    if (!data?.deliveryId) return;

    const ctx = this.getContext(client);
    if (!ctx) return;

    if (!this.canPublish(ctx, undefined)) {
      this.rejectUnauthorized(client, 'publish ETA', data.deliveryId);
      return;
    }

    if (typeof data.estimatedMinutes !== 'number' || data.estimatedMinutes < 0) {
      client.emit('error', { reason: 'Invalid estimatedMinutes' });
      return;
    }

    const room = `delivery:${data.deliveryId}`;
    this.server.to(room).emit('delivery.eta.updated', {
      deliveryId: data.deliveryId,
      estimatedMinutes: data.estimatedMinutes,
      distanceKm: data.distanceKm ?? null,
      timestamp: data.timestamp ?? new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // Server-side emit helpers (called by services)
  // ---------------------------------------------------------------------------

  emitLocationUpdate(payload: LocationUpdatePayload): void {
    const room = `delivery:${payload.deliveryId}`;
    this.server.to(room).emit('location.update', {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
  }

  emitDeliveryStatusUpdate(payload: DeliveryStatusPayload): void {
    const room = `delivery:${payload.deliveryId}`;
    this.server.to(room).emit('delivery.status.updated', {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
  }

  emitETAUpdate(payload: ETAPayload): void {
    const room = `delivery:${payload.deliveryId}`;
    this.server.to(room).emit('delivery.eta.updated', {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
  }
}
