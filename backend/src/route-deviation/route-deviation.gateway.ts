import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

import { RouteDeviationDetectedEvent } from '../events/route-deviation-detected.event';

interface ClientContext {
  userId: string;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: '/deviation',
})
export class RouteDeviationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RouteDeviationGateway.name);
  private readonly connectedClients = new Map<string, ClientContext>();

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token ?? client.handshake.query?.token;

    if (!token) {
      this.logger.warn(`Deviation WS rejected: no token (socket=${client.id})`);
      client.emit('error', { reason: 'Authentication token required' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token as string);
      const userId: string = payload.sub ?? payload.userId;
      this.connectedClients.set(client.id, { userId });
      client.emit('connected', { message: 'Authenticated', userId, timestamp: new Date().toISOString() });
      this.logger.log(`Deviation WS connected: ${client.id} (user=${userId})`);
    } catch (error) {
      this.logger.warn(
        `Deviation WS rejected: invalid token (socket=${client.id}): ${(error as Error).message}`,
      );
      client.emit('error', { reason: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.connectedClients.delete(client.id);
    this.logger.log(`Deviation WS client disconnected: ${client.id}`);
  }

  @SubscribeMessage('deviation.subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId?: string },
  ) {
    const ctx = this.connectedClients.get(client.id);
    if (!ctx) {
      client.emit('error', { reason: 'Authentication required' });
      client.disconnect(true);
      return;
    }

    const room = data?.orderId
      ? `deviation:order:${data.orderId}`
      : 'deviation:global';
    void client.join(room);
    client.emit('deviation.subscribed', { room });
  }

  @OnEvent('route.deviation.detected')
  handleDeviationDetected(event: RouteDeviationDetectedEvent) {
    const payload = {
      incidentId: event.incidentId,
      orderId: event.orderId,
      riderId: event.riderId,
      severity: event.severity,
      deviationDistanceM: event.deviationDistanceM,
      lastKnownLatitude: event.lastKnownLatitude,
      lastKnownLongitude: event.lastKnownLongitude,
      recommendedAction: event.recommendedAction,
      confidenceScore: event.confidenceScore,
      telemetryContext: event.telemetryContext,
      timestamp: new Date().toISOString(),
    };

    this.server.to('deviation:global').emit('deviation.alert', payload);
    this.server
      .to(`deviation:order:${event.orderId}`)
      .emit('deviation.alert', payload);

    this.logger.warn(
      `Deviation alert broadcast: order=${event.orderId} severity=${event.severity}`,
    );
  }

  broadcastResolved(incidentId: string, orderId: string) {
    const payload = {
      incidentId,
      orderId,
      timestamp: new Date().toISOString(),
    };
    this.server.to('deviation:global').emit('deviation.resolved', payload);
    this.server
      .to(`deviation:order:${orderId}`)
      .emit('deviation.resolved', payload);
  }
}
