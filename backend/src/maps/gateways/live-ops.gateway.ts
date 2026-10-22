import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';

import { AuthenticatedSocket, WsAuthService } from '../../auth/ws-auth.service';

export interface LiveRiderPosition {
  riderId: string;
  lat: number;
  lng: number;
  orderId?: string;
  status: string;
  timestamp: Date;
}

export interface LiveIncidentUpdate {
  orderId: string;
  status: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  hospitalId: string;
  bloodType: string;
  region: string;
  timestamp: Date;
}

/**
 * Roles permitted to observe the live-ops feed.
 *
 * Subscribers receive live rider GPS, order IDs, hospital IDs and blood-request
 * urgency, so this is restricted to operator roles rather than any
 * authenticated user. Mirrors the role list used by DispatchGateway.
 */
const OPS_VIEWER_ROLES = ['admin', 'super_admin', 'dispatcher'];

/**
 * Live operations feed.
 *
 * Every connection is authenticated by `WsAuthService` before any handler runs
 * (see `afterInit`). On top of that:
 * - subscribing is limited to operator roles, because the feed carries rider
 *   locations and hospital/blood-request details;
 * - a rider position may only be published by the authenticated rider it
 *   describes, so a client cannot fabricate another rider's position;
 * - coordinates are range-checked before being broadcast.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/ops' })
export class LiveOpsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(LiveOpsGateway.name);

  constructor(private readonly wsAuthService: WsAuthService) {}

  /**
   * Install the JWT handshake middleware.
   *
   * Sockets that fail authentication are rejected before `handleConnection`,
   * so no handler on this namespace can be reached unauthenticated.
   */
  afterInit(server: Server) {
    const authenticate = this.wsAuthService.authenticate();
    server.use((socket, next) => {
      void authenticate(socket as AuthenticatedSocket, next);
    });
    this.logger.log('LiveOpsGateway initialised with JWT authentication');
  }

  handleConnection(client: AuthenticatedSocket) {
    const user = client.user;

    // Defence in depth: the middleware should already have rejected this.
    if (!user) {
      this.logger.warn(
        `Ops client ${client.id} reached handleConnection unauthenticated — disconnecting`,
      );
      client.disconnect(true);
      return;
    }

    this.logger.log(
      `Ops client connected: socketId=${client.id} userId=${user.userId} role=${user.role}`,
    );
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(
      `Ops client disconnected: socketId=${client.id} userId=${client.user?.userId}`,
    );
  }

  /** Operators subscribe to a region filter */
  @SubscribeMessage('ops.subscribe')
  handleSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { region?: string },
  ) {
    const user = client.user;

    if (!user) {
      client.emit('auth_error', 'User not authenticated');
      return;
    }

    if (!OPS_VIEWER_ROLES.includes(user.role || '')) {
      this.logger.warn(
        `Ops subscribe denied for userId=${user.userId} role=${user.role}`,
      );
      client.emit(
        'auth_error',
        'Insufficient permissions: live-ops feed is restricted to operators',
      );
      return;
    }

    const room = data?.region ? `ops:region:${data.region}` : 'ops:global';
    void client.join(room);
    client.emit('ops.subscribed', { room });
  }

  /** Riders push location updates via this event */
  @SubscribeMessage('ops.rider.location')
  handleRiderLocation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: LiveRiderPosition,
  ) {
    const user = client.user;

    if (!user) {
      client.emit('auth_error', 'User not authenticated');
      return;
    }

    if (!payload || typeof payload.riderId !== 'string') {
      client.emit('ops.error', 'Invalid rider position payload');
      return;
    }

    // A client may only report its own position. Without this, any connected
    // client could broadcast a fabricated location for any rider.
    if (payload.riderId !== user.userId) {
      this.logger.warn(
        `Rejected rider position for riderId=${payload.riderId} from userId=${user.userId}`,
      );
      client.emit(
        'auth_error',
        'Insufficient permissions: cannot publish another rider position',
      );
      return;
    }

    if (!this.hasValidCoordinates(payload)) {
      client.emit('ops.error', 'Invalid coordinates');
      return;
    }

    this.broadcastRiderPosition(payload);
  }

  /** Latitude/longitude must be real, finite, in-range values. */
  private hasValidCoordinates(payload: LiveRiderPosition): boolean {
    const { lat, lng } = payload;
    return (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  }

  /** Broadcast rider position to all ops subscribers */
  broadcastRiderPosition(payload: LiveRiderPosition) {
    this.server.to('ops:global').emit('ops.rider.moved', payload);
  }

  /** Called by order/incident services when status changes */
  @OnEvent('order.status.updated')
  handleOrderStatusUpdated(payload: LiveIncidentUpdate) {
    this.server.to('ops:global').emit('ops.incident.updated', payload);
    if (payload.region) {
      this.server
        .to(`ops:region:${payload.region}`)
        .emit('ops.incident.updated', payload);
    }
  }

  /** Emit current snapshot to a newly connected operator */
  emitSnapshot(
    client: Socket,
    snapshot: { riders: LiveRiderPosition[]; incidents: LiveIncidentUpdate[] },
  ) {
    client.emit('ops.snapshot', snapshot);
  }
}
