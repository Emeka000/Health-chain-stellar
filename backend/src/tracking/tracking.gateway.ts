import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
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
import { DispatchRecord } from '../dispatch/entities/dispatch-record.entity';

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
  eventId?: string;
  sequenceNumber?: number;
}

interface DeliveryStatusPayload {
  deliveryId: string;
  status: string;
  riderId?: string;
  timestamp?: string;
  eventId?: string;
}

interface ETAPayload {
  deliveryId: string;
  estimatedMinutes: number;
  distanceKm?: number;
  timestamp?: string;
  eventId?: string;
}

interface StreamState {
  lastSequenceNumber: number;
  bufferedLocationEvents: Map<number, LocationUpdatePayload>;
  recentEventIds: Map<string, number>;
}

const EVENT_RETENTION_MS = 5 * 60_000;

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
  private readonly streamStates = new Map<string, StreamState>();

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(DispatchRecord)
    private readonly dispatchRepo: Repository<DispatchRecord>,
  ) {}

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
   * Regular users are not allowed to subscribe to other users' deliveries.
   */
  private async canSubscribe(ctx: ClientContext, deliveryId: string): Promise<boolean> {
    // Admins and dispatchers have full access
    if (['admin', 'super_admin', 'dispatcher'].includes(ctx.role)) {
      return true;
    }

    // For non-admin users, verify ownership of the delivery by looking up the dispatch record
    const dispatch = await this.dispatchRepo.findOne({
      where: { orderId: deliveryId },
    });

    if (!dispatch) {
      this.logger.warn(
        `Delivery not found: deliveryId=${deliveryId} user=${ctx.userId}`,
      );
      return false;
    }

    // Riders can only access their assigned deliveries
    if (ctx.role === 'rider' && ctx.riderId) {
      return ctx.riderId === dispatch.riderId;
    }

    // Other authenticated roles (user) cannot subscribe to deliveries
    return false;
  }

  /**
   * Resolves the rider assigned to a delivery server-side (cached).
   * Never trusts client-supplied riderId for authorization.
   */
  private async resolveAssignedRider(deliveryId: string): Promise<string | undefined> {
    const cached = this.assignedRiderCache.get(deliveryId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.riderId;
    }

    const dispatch = await this.dispatchRepo.findOne({
      where: { orderId: deliveryId },
    });

    const riderId = dispatch?.riderId ?? undefined;
    this.assignedRiderCache.set(deliveryId, {
      riderId,
      expiresAt: Date.now() + ASSIGNED_RIDER_CACHE_TTL_MS,
    });
    return riderId;
  }

  /**
   * Returns true if the client is allowed to PUBLISH events for a delivery.
   * Only the assigned rider (resolved server-side) or admins/dispatchers may publish.
   * The client-supplied riderId is ignored for authorization.
   */
  private async canPublish(ctx: ClientContext, deliveryId: string): Promise<boolean> {
    if (['admin', 'super_admin', 'dispatcher'].includes(ctx.role)) return true;
    if (ctx.role !== 'rider' || !ctx.riderId) return false;

    const assignedRiderId = await this.resolveAssignedRider(deliveryId);
    return !!assignedRiderId && ctx.riderId === assignedRiderId;
  }

  private getContext(client: Socket): ClientContext | null {
    return this.connectedClients.get(client.id) ?? null;
  }

  private getStreamKey(deliveryId: string, riderId?: string): string {
    return `${deliveryId}:${riderId ?? 'unknown'}`;
  }

  private getStreamState(streamKey: string): StreamState {
    const existing = this.streamStates.get(streamKey);
    if (existing) {
      return existing;
    }

    const created: StreamState = {
      lastSequenceNumber: -1,
      bufferedLocationEvents: new Map(),
      recentEventIds: new Map(),
    };
    this.streamStates.set(streamKey, created);
    return created;
  }

  private buildEventId(kind: string, payload: Record<string, unknown>): string {
    return createHash('sha256')
      .update(JSON.stringify({ kind, payload }))
      .digest('hex');
  }

  private isDuplicateEvent(state: StreamState, eventId: string): boolean {
    const now = Date.now();
    for (const [storedId, seenAt] of state.recentEventIds) {
      if (now - seenAt > EVENT_RETENTION_MS) {
        state.recentEventIds.delete(storedId);
      }
    }

    if (state.recentEventIds.has(eventId)) {
      return true;
    }

    state.recentEventIds.set(eventId, now);
    return false;
  }

  private emitLocationPayload(payload: LocationUpdatePayload): void {
    const room = `delivery:${payload.deliveryId}`;
    this.server.to(room).emit('location.update', {
      riderId: payload.riderId,
      deliveryId: payload.deliveryId,
      latitude: payload.latitude,
      longitude: payload.longitude,
      speed: payload.speed ?? null,
      heading: payload.heading ?? null,
      sequenceNumber: payload.sequenceNumber ?? null,
      eventId: payload.eventId ?? null,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
  }

  private emitStatusPayload(payload: DeliveryStatusPayload): void {
    const room = `delivery:${payload.deliveryId}`;
    this.server.to(room).emit('delivery.status.updated', {
      deliveryId: payload.deliveryId,
      status: payload.status,
      riderId: payload.riderId ?? null,
      eventId: payload.eventId ?? null,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
  }

  private emitETAPayload(payload: ETAPayload): void {
    const room = `delivery:${payload.deliveryId}`;
    this.server.to(room).emit('delivery.eta.updated', {
      deliveryId: payload.deliveryId,
      estimatedMinutes: payload.estimatedMinutes,
      distanceKm: payload.distanceKm ?? null,
      eventId: payload.eventId ?? null,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
  }

  @SubscribeMessage('rider.location')
  async handleLocationUpdate(
    @MessageBody() data: LocationUpdatePayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const ctx = this.getContext(client);
    if (!ctx) {
      client.emit('error', { reason: 'Not authenticated' });
      return;
    }

    if (!data?.deliveryId) {
      client.emit('error', { reason: 'deliveryId is required' });
      return;
    }

    if (!(await this.canPublish(ctx, data.deliveryId))) {
      this.logger.warn(
        `Publish denied (location): deliveryId=${data.deliveryId} user=${ctx.userId} role=${ctx.role}`,
      );
      client.emit('error', { reason: 'Not authorized to publish for this delivery' });
      return;
    }

    if (
      typeof data.latitude !== 'number' ||
      typeof data.longitude !== 'number' ||
      data.latitude < LAT_MIN ||
      data.latitude > LAT_MAX ||
      data.longitude < LON_MIN ||
      data.longitude > LON_MAX
    ) {
      client.emit('error', { reason: 'Invalid coordinates' });
      return;
    }

    const streamKey = this.getStreamKey(data.deliveryId, ctx.riderId);
    const state = this.getStreamState(streamKey);

    const eventId =
      data.eventId ?? this.buildEventId('location', data as unknown as Record<string, unknown>);

    if (this.isDuplicateEvent(state, eventId)) {
      return;
    }

    const sequenceNumber = data.sequenceNumber ?? state.lastSequenceNumber + 1;
    state.lastSequenceNumber = Math.max(state.lastSequenceNumber, sequenceNumber);

    this.emitLocationPayload({
      ...data,
      riderId: ctx.riderId ?? data.riderId,
      eventId,
      sequenceNumber,
    });
  }

  @SubscribeMessage('delivery.status')
  async handleDeliveryStatus(
    @MessageBody() data: DeliveryStatusPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const ctx = this.getContext(client);
    if (!ctx) {
      client.emit('error', { reason: 'Not authenticated' });
      return;
    }

    if (!data?.deliveryId) {
      client.emit('error', { reason: 'deliveryId is required' });
      return;
    }

    if (!(await this.canPublish(ctx, data.deliveryId))) {
      this.logger.warn(
        `Publish denied (status): deliveryId=${data.deliveryId} user=${ctx.userId} role=${ctx.role}`,
      );
      client.emit('error', { reason: 'Not authorized to publish for this delivery' });
      return;
    }

    if (!data.status || !VALID_DELIVERY_STATUSES.has(data.status)) {
      client.emit('error', { reason: 'Invalid delivery status' });
      return;
    }

    const streamKey = this.getStreamKey(data.deliveryId, ctx.riderId);
    const state = this.getStreamState(streamKey);

    const eventId =
      data.eventId ?? this.buildEventId('status', data as unknown as Record<string, unknown>);

    if (this.isDuplicateEvent(state, eventId)) {
      return;
    }

    this.emitStatusPayload({
      ...data,
      riderId: ctx.riderId ?? data.riderId,
      eventId,
    });
  }

  @SubscribeMessage('delivery.eta')
  async handleDeliveryETA(
    @MessageBody() data: ETAPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const ctx = this.getContext(client);
    if (!ctx) {
      client.emit('error', { reason: 'Not authenticated' });
      return;
    }

    if (!data?.deliveryId) {
      client.emit('error', { reason: 'deliveryId is required' });
      return;
    }

    if (!(await this.canPublish(ctx, data.deliveryId))) {
      this.logger.warn(
        `Publish denied (eta): deliveryId=${data.deliveryId} user=${ctx.userId} role=${ctx.role}`,
      );
      client.emit('error', { reason: 'Not authorized to publish for this delivery' });
      return;
    }

    if (typeof data.estimatedMinutes !== 'number' || data.estimatedMinutes < 0) {
      client.emit('error', { reason: 'Invalid estimatedMinutes' });
      return;
    }

    const streamKey = this.getStreamKey(data.deliveryId, ctx.riderId);
    const state = this.getStreamState(streamKey);

    const eventId =
      data.eventId ?? this.buildEventId('eta', data as unknown as Record<string, unknown>);

    if (this.isDuplicateEvent(state, eventId)) {
      return;
    }

    this.emitETAPayload({
      ...data,
      eventId,
    });
  }

  @SubscribeMessage('delivery.subscribe')
  async handleSubscribe(
    @MessageBody() data: { deliveryId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const ctx = this.getContext(client);
    if (!ctx) {
      client.emit('error', { reason: 'Not authenticated' });
      return;
    }

    if (!data?.deliveryId) {
      client.emit('error', { reason: 'deliveryId is required' });
      return;
    }

    if (!(await this.canSubscribe(ctx, data.deliveryId))) {
      this.logger.warn(
        `Subscribe denied: deliveryId=${data.deliveryId} user=${ctx.userId} role=${ctx.role}`,
      );
      client.emit('error', { reason: 'Not authorized to subscribe to this delivery' });
      return;
    }

    const room = `delivery:${data.deliveryId}`;
    await client.join(room);
    ctx.rooms.add(room);

    client.emit('subscribed', { deliveryId: data.deliveryId, room });
    this.logger.log(`Tracking WS subscribed: ${client.id} -> ${room}`);
  }

  @SubscribeMessage('delivery.unsubscribe')
  async handleUnsubscribe(
    @MessageBody() data: { deliveryId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const ctx = this.getContext(client);
    if (!ctx) {
      client.emit('error', { reason: 'Not authenticated' });
      return;
    }

    if (!data?.deliveryId) {
      client.emit('error', { reason: 'deliveryId is required' });
      return;
    }

    const room = `delivery:${data.deliveryId}`;
    await client.leave(room);
    ctx.rooms.delete(room);

    client.emit('unsubscribed', { deliveryId: data.deliveryId, room });
    this.logger.log(`Tracking WS unsubscribed: ${client.id} <- ${room}`);
  }
}
