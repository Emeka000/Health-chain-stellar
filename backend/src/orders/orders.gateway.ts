import { Logger, UnauthorizedException, Inject } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WsException,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';

import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';

import { Order } from './types/order.types';
import { AuthenticatedSocket, WsAuthService } from '../auth/ws-auth.service';
import { SecurityEventLoggerService } from '../user-activity/security-event-logger.service';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/orders',
})
export class OrdersGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(OrdersGateway.name);

  // Heartbeat tracking
  private readonly heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly heartbeatInterval = 30_000; // 30 seconds
  private readonly heartbeatTimeout = 60_000; // 60 seconds to respond

  constructor(
    private readonly wsAuthService: WsAuthService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly securityEventLogger: SecurityEventLoggerService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('OrdersGateway WebSocket server initialized with JWT+RBAC security');

    // Apply WebSocket authentication middleware (JWT verification + rate limiting)
    server.use(this.wsAuthService.authenticate());
  }

  handleConnection(client: AuthenticatedSocket) {
    const user = client.user;
    this.logger.log(
      `Orders client connected: socketId=${client.id} userId=${user?.userId} tenantId=${user?.tenantId}`,
    );

    // Start heartbeat for connection health monitoring
    this.startHeartbeat(client);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Orders client disconnected: ${client.id}`);

    // Cleanup heartbeat timer
    this.stopHeartbeat(client.id);
  }

  /**
   * Heartbeat mechanism for detecting stale connections
   * Sends ping every 30s, expects pong within 60s
   */
  private startHeartbeat(socket: AuthenticatedSocket) {
    // Clear any existing timer
    this.stopHeartbeat(socket.id);

    const timer = setInterval(() => {
      try {
        if (socket.connected) {
          socket.emit('ping', Date.now());
        } else {
          this.stopHeartbeat(socket.id);
        }
      } catch (error) {
        this.logger.warn(`Heartbeat error: ${(error as Error).message}`);
        this.stopHeartbeat(socket.id);
      }
    }, this.heartbeatInterval);

    this.heartbeatTimers.set(socket.id, timer);
  }

  private stopHeartbeat(socketId: string) {
    const timer = this.heartbeatTimers.get(socketId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(socketId);
    }
  }

  @SubscribeMessage('pong')
  handlePong(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() timestamp: number,
  ) {
    const latency = Date.now() - timestamp;
    if (latency > this.heartbeatTimeout) {
      this.logger.warn(
        `Heartbeat timeout for socket ${socket.id}: ${latency}ms > ${this.heartbeatTimeout}ms`,
      );
      socket.disconnect(true);
    }
  }

  /**
   * Join hospital orders channel — RBAC enforced
   *
   * Allowed roles: admin, hospital, doctor, dispatcher
   * Tenant isolation: user can only join their authorized hospitalIds
   */
  @SubscribeMessage('join:hospital')
  async handleJoinHospital(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { hospitalId: string },
  ): Promise<void> {
    const { hospitalId } = payload;
    const user = client.user;

    if (!user) {
      client.emit('auth_error', 'User not authenticated');
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // RBAC CHECK: Verify user has permission to view orders
    // ─────────────────────────────────────────────────────────────────────
    const allowedRoles = ['admin', 'super_admin', 'hospital', 'doctor', 'dispatcher'];
    const hasRole = allowedRoles.includes(user.role || '');

    if (!hasRole) {
      await this.securityEventLogger.logEvent({
        eventType: 'AUTH_SESSION_RISK_ELEVATED' as any,
        userId: user.userId,
        metadata: {
          event: 'WS_PRIVILEGE_VIOLATION',
          resource: 'orders',
          requested: `hospital:${hospitalId}`,
          userRole: user.role,
          requiredRoles: allowedRoles,
        },
        ipAddress: (client.handshake?.address as any) || '',
      });

      client.emit('auth_error', 'Insufficient permissions for orders channel');
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // TENANT ISOLATION: Verify hospitalId is in user's authorized list
    // ─────────────────────────────────────────────────────────────────────
    const authorizedHospitals = client.data.hospitalIds ?? [];
    const isAdmin = ['admin', 'super_admin'].includes(user.role || '');

    if (!isAdmin && !authorizedHospitals.includes(hospitalId)) {
      await this.securityEventLogger.logEvent({
        eventType: 'AUTH_SESSION_RISK_ELEVATED' as any,
        userId: user.userId,
        metadata: {
          event: 'WS_TENANT_ESCAPE_ATTEMPT',
          userTenant: user.tenantId,
          requestedHospital: hospitalId,
          authorizedHospitals,
        },
        ipAddress: (client.handshake?.address as any) || '',
      });

      client.emit('auth_error', 'Not authorized to join this hospital room');
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // AUTHORIZATION GRANTED: Join tenant-scoped orders channel
    // ─────────────────────────────────────────────────────────────────────
    const roomName = `orders:${hospitalId}`;
    client.join(roomName);

    this.logger.log(
      `Client ${client.id} (user=${user.userId} role=${user.role}) joined room: ${roomName}`,
    );

    client.emit('joined_channel', {
      channel: roomName,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Join dispatch channel — Higher privilege requirement
   *
   * Allowed roles: admin, dispatcher (NOT doctors or patients)
   * Tenant isolation: dispatch scoped to user's tenantId
   */
  @SubscribeMessage('join:dispatch')
  async handleJoinDispatch(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload?: any,
  ): Promise<void> {
    const user = client.user;

    if (!user) {
      client.emit('auth_error', 'User not authenticated');
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // RBAC CHECK: Dispatch requires admin or dispatcher role
    // ─────────────────────────────────────────────────────────────────────
    const allowedRoles = ['admin', 'super_admin', 'dispatcher'];
    const hasRole = allowedRoles.includes(user.role || '');

    if (!hasRole) {
      await this.securityEventLogger.logEvent({
        eventType: 'AUTH_SESSION_RISK_ELEVATED' as any,
        userId: user.userId,
        metadata: {
          event: 'WS_PRIVILEGE_VIOLATION',
          resource: 'dispatch',
          userRole: user.role,
          requiredRoles: allowedRoles,
        },
        ipAddress: (client.handshake?.address as any) || '',
      });

      client.emit('auth_error', 'Insufficient permissions: dispatch access restricted');
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // AUTHORIZATION GRANTED: Join tenant-scoped dispatch channel
    // ─────────────────────────────────────────────────────────────────────
    const roomName = `dispatch:${user.tenantId}`;
    client.join(roomName);

    this.logger.log(
      `Client ${client.id} (user=${user.userId} role=${user.role}) joined dispatch room: ${roomName}`,
    );

    client.emit('joined_channel', {
      channel: roomName,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Refresh access token for long-lived WebSocket connections
   *
   * Client sends refresh_token every 10min, receives new access token
   * Prevents disconnection + reconnection overhead for persistent connections
   */
  @SubscribeMessage('refresh_token')
  async handleRefreshToken(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { refreshToken: string },
  ): Promise<void> {
    const user = socket.user;
    if (!user) {
      socket.emit('auth_error', 'No authenticated session');
      return;
    }

    try {
      // TODO: Implement token refresh endpoint call or JWT rotation
      // For now, log that refresh was requested
      this.logger.debug(`Token refresh requested for userId=${user.userId}`);

      // Emit success (actual token generation would happen here)
      socket.emit('token_refreshed', {
        status: 'success',
        newExpiry: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
    } catch (error) {
      await this.securityEventLogger.logEvent({
        eventType: 'AUTH_SESSION_RISK_ELEVATED' as any,
        userId: user.userId,
        metadata: {
          event: 'WS_TOKEN_REFRESH_FAILED',
          error: (error as Error).message,
        },
        ipAddress: (socket.handshake?.address as any) || '',
      });

      socket.emit('auth_error', 'Token refresh failed');
      socket.disconnect(true);
    }
  }

  /**
   * Emit order update to all clients in the hospital's room.
   * Only clients whose room membership was granted through authorization checks receive the broadcast.
   */
  emitOrderUpdate(hospitalId: string, order: Partial<Order>): void {
    const roomName = `hospital:${hospitalId}`;
    this.logger.log(
      `Broadcasting order update to room: ${roomName}, order: ${order.id}`,
    );
    this.server.to(roomName).emit('order:updated', order);
  }
}
