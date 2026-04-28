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

import { RouteDeviationDetectedEvent } from '../events/route-deviation-detected.event';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/deviation' })
export class RouteDeviationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RouteDeviationGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Deviation WS client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Deviation WS client disconnected: ${client.id}`);
  }

  @SubscribeMessage('deviation.subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId?: string },
  ) {
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
