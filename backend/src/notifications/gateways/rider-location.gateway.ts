import { EventEmitter2 } from "@nestjs/event-emitter";
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Socket } from "socket.io";
import { Server } from "socket.io";
import { RedisLocationRepository } from "src/redis/redis-location.repository";
import { calculateDistance } from "src/tracking/geofence.util";


@WebSocketGateway({ cors: { origin: '*' } })
export class RiderLocationGateway {
  @WebSocketServer() server: Server;
  private readonly DEVIATION_THRESHOLD = 2.0; 

  constructor(
    private readonly redisRepo: RedisLocationRepository,
    private readonly eventEmitter: EventEmitter2 
  ) {}

  @SubscribeMessage('rider.location.update')
  async handleLocationUpdate(
    @MessageBody() data: { riderId: string; lat: number; lng: number; orderId: string }
  ) {
    const { riderId, lat, lng, orderId } = data;

    await this.redisRepo.updateLocation(riderId, lat, lng);

    this.server.to(`order:${orderId}`).emit('order.rider.location', { lat, lng });
     ////////////////////////////////////////////////////////////////////
    // 3. Geofence Check (Simplified example against a fixed route point)
    // In a real app, you'd fetch the 'expectedRoutePoint' from a DB
    const expectedRoutePoint = { lat: 6.5244, lng: 3.3792 }; 
    /////////////////////////////////////////////////////////////////////////
    const distance = calculateDistance(lat, lng, expectedRoutePoint.lat, expectedRoutePoint.lng);

    if (distance > this.DEVIATION_THRESHOLD) {
      this.triggerDeviationAlert(riderId, distance);
    }
  }

  private triggerDeviationAlert(riderId: string, distance: number) {
    const alertData = { riderId, deviation: distance, timestamp: new Date() };
    this.server.emit('RiderDeviationEvent', alertData); // Notify Admins
    console.warn(`ALERT: Rider ${riderId} deviated by ${distance}km`);
  }

  @SubscribeMessage('hospital.subscribe')
  handleJoinOrder(@ConnectedSocket() client: Socket, @MessageBody() data: { orderId: string }) {
    client.join(`order:${data.orderId}`);
  }
}