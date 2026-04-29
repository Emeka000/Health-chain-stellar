/**
 * Dispatch WebSocket Gateway
 *
 * Real-time dispatch operations with JWT+RBAC security
 * Handles order assignment, rider tracking, and dispatch coordination
 *
 * Issues #562: Secure WebSocket Gateways with JWT + RBAC
 */

import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';

import { Server } from 'socket.io';

import { AuthenticatedSocket, WsAuthService } from '../auth/ws-auth.service';
import { SecurityEventLoggerService } from '../user-activity/security-event-logger.service';

export interface DispatchAssignmentPayload {
  orderId: string;
  riderId: string;
  estimatedTime?: number;
}

export interface DispatchUpdatePayload {
  orderId: string;
  status: 'assigned' | 'in_transit' | 'delivered' | 'cancelled';
  updatedAt: string;
  metadata?: Record<string, any>;
}

/**
 * Dispatch Gateway
 *
 * Security Requirements:
 * - All connections require valid JWT token (enforced via WsAuthService middleware)
 * - Only admin/dispatcher roles can access dispatch channels
 * - Tenant isolation: dispatchers can only access their assigned tenantId
 * - All actions logged for audit trail and compliance
 * - Rate limiting: 10 dispatcher events per second per tenant
 */
@WebSocketGateway({
  namespace: '/dispatch',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class DispatchGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(DispatchGateway.name);

  // Heartbeat tracking for long-lived connections
  private readonly heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly heartbeatInterval = 30_000; // 30 seconds
  private readonly heartbeatTimeout = 60_000; // 60 seconds

  constructor(
    private readonly wsAuthService: WsAuthService,
    private readonly securityEventLogger: SecurityEventLoggerService,
  ) {}

  /**
   * Initialize gateway with JWT authentication middleware
   *
   * All WebSocket connections MUST validate JWT before message handling
   */
  afterInit(server: Server) {
    this.logger.log('DispatchGateway WebSocket server initialized with JWT+RBAC security');

    // Apply WebSocket authentication middleware
    server.use(this.wsAuthService.authenticate());
  }

  /**
   * Handle new WebSocket connection
   *
   * At this point:
   * - JWT is already verified by WsAuthService middleware
   * - socket.user contains authenticated user context
   * - socket.data.tenantId = user's organization
   */
  handleConnection(client: AuthenticatedSocket) {
    const user = client.user;
    this.logger.log(
      `Dispatch client connected: socketId=${client.id} userId=${user?.userId} tenantId=${user?.tenantId}`,
    );

    // Start heartbeat for connection health monitoring
    this.startHeartbeat(client);

    // Log connection event for audit
    this.auditEvent('DISPATCH_CONNECTION', {
      socketId: client.id,
      userId: user?.userId,
      tenantId: user?.tenantId,
      role: user?.role,
    });
  }

  /**
   * Handle WebSocket disconnection
   *
   * Cleanup resources and log for audit trail
   */
  handleDisconnect(client: AuthenticatedSocket) {
    const user = client.user;
    this.logger.log(
      `Dispatch client disconnected: socketId=${client.id} userId=${user?.userId}`,
    );

    // Cleanup heartbeat timer
    this.stopHeartbeat(client.id);

    // Log disconnection event
    this.auditEvent('DISPATCH_DISCONNECTION', {
      socketId: client.id,
      userId: user?.userId,
      tenantId: user?.tenantId,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HEARTBEAT MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start heartbeat for connection health monitoring
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

  /**
   * Stop heartbeat and cleanup timer
   */
  private stopHeartbeat(socketId: string) {
    const timer = this.heartbeatTimers.get(socketId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(socketId);
    }
  }

  /**
   * Handle heartbeat pong response
   */
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

  // ─────────────────────────────────────────────────────────────────────────
  // CHANNEL JOINING & RBAC
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Join dispatch room — Admin/Dispatcher only
   *
   * Channel naming: dispatch:tenantId
   * Only users with admin or dispatcher role can access
   * Tenant scope: users can only access their own tenantId
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
    // RBAC: Dispatch requires admin or dispatcher role
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

      this.logger.warn(
        `Dispatch access denied for user=${user.userId} role=${user.role}`,
      );
      client.emit('auth_error', 'Insufficient permissions: dispatch access restricted to admin/dispatcher');
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // TENANT ISOLATION: User can only join their own tenantId
    // ─────────────────────────────────────────────────────────────────────
    const tenantId = user.tenantId;
    const roomName = `dispatch:${tenantId}`;

    client.join(roomName);

    this.logger.log(
      `User ${user.userId} (role=${user.role}) joined dispatch room: ${roomName}`,
    );

    client.emit('joined_channel', {
      channel: roomName,
      timestamp: new Date().toISOString(),
    });

    await this.auditEvent('DISPATCH_ROOM_JOINED', {
      userId: user.userId,
      tenantId,
      room: roomName,
    });
  }

  /**
   * Subscribe to specific order dispatch updates
   *
   * Allows dispatchers/admins to track specific order assignments
   */
  @SubscribeMessage('subscribe:order')
  async handleSubscribeOrder(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { orderId: string },
  ): Promise<void> {
    const user = client.user;
    if (!user) {
      client.emit('auth_error', 'Not authenticated');
      return;
    }

    const { orderId } = payload;

    // Verify role
    const allowedRoles = ['admin', 'super_admin', 'dispatcher'];
    if (!allowedRoles.includes(user.role || '')) {
      await this.securityEventLogger.logEvent({
        eventType: 'AUTH_SESSION_RISK_ELEVATED' as any,
        userId: user.userId,
        metadata: {
          event: 'WS_PRIVILEGE_VIOLATION',
          resource: `order:${orderId}`,
        },
        ipAddress: (client.handshake?.address as any) || '',
      });
      client.emit('auth_error', 'Unauthorized to subscribe to order updates');
      return;
    }

    const roomName = `order:${orderId}:${user.tenantId}`;
    client.join(roomName);

    this.logger.log(
      `User ${user.userId} subscribed to order updates: ${roomName}`,
    );

    client.emit('subscribed_order', {
      orderId,
      tenantId: user.tenantId,
      timestamp: new Date().toISOString(),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DISPATCH OPERATIONS (publish to channels, don't handle here)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Broadcast assignment to all dispatchers in tenant
   *
   * Called from DispatchService when assignment is made
   */
  broadcastAssignment(
    tenantId: string,
    assignment: DispatchAssignmentPayload,
  ): void {
    const roomName = `dispatch:${tenantId}`;
    this.logger.log(`Broadcasting assignment to ${roomName}:`, assignment);

    this.server.to(roomName).emit('order:assigned', {
      ...assignment,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast dispatch status update to all subscribers
   *
   * Called from DispatchService when status changes
   */
  broadcastDispatchUpdate(
    tenantId: string,
    update: DispatchUpdatePayload,
  ): void {
    // Send to general dispatch room
    this.server.to(`dispatch:${tenantId}`).emit('dispatch:updated', update);

    // Send to specific order subscribers
    this.server
      .to(`order:${update.orderId}:${tenantId}`)
      .emit('order:status_changed', update);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AUDIT & LOGGING
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Log dispatch-related security events
   */
  private async auditEvent(
    eventType: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    try {
      this.logger.log(
        JSON.stringify({
          at: new Date().toISOString(),
          event: eventType,
          ...metadata,
        }),
      );

      // Could also call securityEventLogger here for persistent audit trail
      // await this.securityEventLogger.logEvent({...})
    } catch (error) {
      this.logger.error(`Failed to audit event: ${(error as Error).message}`);
    }
  }
}
