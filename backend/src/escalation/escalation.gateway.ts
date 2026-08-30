import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

import { EscalationTriggeredEvent } from '../../events/escalation-triggered.event';
import { EscalationAcknowledgedEvent } from '../../events/escalation-acknowledged.event';

@WebSocketGateway({
  namespace: '/escalations',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
export class EscalationGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EscalationGateway.name);
  private readonly connectedClients = new Map<string, { userId: string; hospitalId: string }>();

  constructor(private readonly jwtService: JwtService) {}

  afterInit(): void {
    this.logger.log('EscalationGateway initialised');
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token ?? client.handshake.query?.token;

    if (!token) {
      this.logger.warn(`Escalation WS rejected: no token (socket=${client.id})`);
      client.emit('error', { reason: 'Authentication token required' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token as string);
      const userId: string = payload.sub ?? payload.userId;
      const hospitalId: string = payload.hospitalId ?? payload.tenantId;

      if (!hospitalId) {
        client.emit('error', { reason: 'Token missing hospitalId claim' });
        client.disconnect(true);
        return;
      }

      this.connectedClients.set(client.id, { userId, hospitalId });
      await client.join(`hospital:${hospitalId}`);

      client.emit('connected', { message: 'Authenticated', userId, timestamp: new Date().toISOString() });
      this.logger.log(`Escalation WS connected: ${client.id} (user=${userId} hospital=${hospitalId})`);
    } catch (error) {
      this.logger.warn(
        `Escalation WS rejected: invalid token (socket=${client.id}): ${(error as Error).message}`,
      );
      client.emit('error', { reason: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.connectedClients.delete(client.id);
    this.logger.log(`Escalation WS disconnected: ${client.id}`);
  }

  @OnEvent('escalation.triggered')
  handleTriggered(event: EscalationTriggeredEvent): void {
    this.server.to(`hospital:${event.hospitalId}`).emit('escalation.triggered', event);
    this.logger.log(`[WS] escalation.triggered tier=${event.tier} request=${event.requestId} hospital=${event.hospitalId}`);
  }

  @OnEvent('escalation.acknowledged')
  handleAcknowledged(event: EscalationAcknowledgedEvent): void {
    this.server.to(`hospital:${event.hospitalId}`).emit('escalation.acknowledged', event);
    this.logger.log(`[WS] escalation.acknowledged id=${event.escalationId} hospital=${event.hospitalId}`);
  }
}
