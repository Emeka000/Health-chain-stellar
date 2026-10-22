import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';

interface OrderStatusPayload {
  orderId: string;
  newStatus: string;
}

interface BloodRequestStatusPayload {
  requestId: string;
  newStatus: string;
}

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  afterInit(): void {
    this.logger.log('NotificationsGateway WebSocket server initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    const rawAuthToken = client.handshake.auth?.token as unknown;
    const rawQueryToken = client.handshake.query?.token as unknown;
    const rawHeader = client.handshake.headers?.authorization as unknown;

    const token: string | undefined =
      typeof rawAuthToken === 'string'
        ? rawAuthToken
        : typeof rawQueryToken === 'string'
          ? rawQueryToken
          : typeof rawHeader === 'string' && rawHeader.startsWith('Bearer ')
            ? rawHeader.substring(7)
            : undefined;

    if (!token) {
      this.logger.warn(
        `Notifications WS rejected: no token (socket=${client.id})`,
      );
      client.emit('error', { reason: 'Authentication token required' });
      client.disconnect(true);
      return;
    }

    try {
      const payload: Record<string, unknown> =
        await this.jwtService.verifyAsync<Record<string, unknown>>(token);
      const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
      const userId =
        typeof payload.userId === 'string' ? payload.userId : undefined;
      const recipientId = sub ?? userId;

      if (!recipientId) {
        this.logger.warn(
          `Notifications WS rejected: missing recipientId claim in token (socket=${client.id})`,
        );
        client.emit('error', { reason: 'Invalid token payload' });
        client.disconnect(true);
        return;
      }

      await client.join(`recipient_${recipientId}`);
      client.emit('connected', {
        message: 'Authenticated',
        recipientId,
        timestamp: new Date().toISOString(),
      });
      this.logger.log(
        `Client ${client.id} connected and joined room recipient_${recipientId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Notifications WS rejected: invalid token (socket=${client.id}): ${(error as Error).message}`,
      );
      client.emit('error', { reason: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`WebSocket client disconnected: ${client.id}`);
  }

  /**
   * Listen to Order status updates and notify recipient.
   */
  @OnEvent('order.status.updated')
  handleOrderStatusUpdated(payload: OrderStatusPayload): void {
    const orderId = payload.orderId;
    const newStatus = payload.newStatus;
    this.logger.log(`WS Notification [Order]: ${orderId} -> ${newStatus}`);
    this.server.emit('blood-request.status-changed', {
      type: 'ORDER',
      id: orderId,
      newStatus,
      timestamp: new Date(),
    });
  }

  /**
   * Listen to BloodRequest status updates and notify recipient.
   */
  @OnEvent('blood-request.status.updated')
  handleBloodRequestStatusUpdated(payload: BloodRequestStatusPayload): void {
    const requestId = payload.requestId;
    const newStatus = payload.newStatus;
    this.logger.log(
      `WS Notification [BloodRequest]: ${requestId} -> ${newStatus}`,
    );
    this.server.emit('blood-request.status-changed', {
      type: 'BLOOD_REQUEST',
      id: requestId,
      newStatus,
      timestamp: new Date(),
    });
  }

  emitToRecipient(recipientId: string, payload: Record<string, unknown>): void {
    this.server
      .to(`recipient_${recipientId}`)
      .emit('notification.new', payload);
    this.logger.log(`Emitted notification.new to recipient_${recipientId}`);
  }
}
