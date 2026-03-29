import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';

import { EscalationTriggeredEvent } from '../../events/escalation-triggered.event';
import { EscalationAcknowledgedEvent } from '../../events/escalation-acknowledged.event';

@WebSocketGateway({
  namespace: '/escalations',
  cors: { origin: '*', methods: ['GET', 'POST'] },
})
export class EscalationGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EscalationGateway.name);

  afterInit(): void {
    this.logger.log('EscalationGateway initialised');
  }

  @OnEvent('escalation.triggered')
  handleTriggered(event: EscalationTriggeredEvent): void {
    this.server.emit('escalation.triggered', event);
    this.logger.log(`[WS] escalation.triggered tier=${event.tier} request=${event.requestId}`);
  }

  @OnEvent('escalation.acknowledged')
  handleAcknowledged(event: EscalationAcknowledgedEvent): void {
    this.server.emit('escalation.acknowledged', event);
    this.logger.log(`[WS] escalation.acknowledged id=${event.escalationId}`);
  }
}
