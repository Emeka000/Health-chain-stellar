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
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';

import { Order } from '../types/order.types';

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
    hospitalIds?: string[];
    role?: string;
  };
}

export interface OrderStatusUpdatedPayload {
  orderId: string;
  previousStatus: string;
  newStatus: string;
  eventType: string;
  actorId?: string | null;
  timestamp: Date;
}

@WebSocketGateway({
  namespace: '/orders',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class OrdersGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(OrdersGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(server: Server): void {
    this.logger.log('OrdersGateway WebSocket server initialised');

    server.use((socket: AuthenticatedSocket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace('Bearer ', '');

        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const secret = this.configService.get<string>('JWT_SECRET');
        const payload = this.jwtService.verify<{
          sub: string;
          hospitalIds?: string[];
          role?: string;
          exp?: number;
        }>(token, { secret });

        // Reject expired tokens (verify already throws, but be explicit)
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          return next(new Error('Token expired'));
        }

        socket.data.userId = payload.sub;
        socket.data.hospitalIds = payload.hospitalIds ?? [];
        socket.data.role = payload.role;

        this.logger.log(`Client authenticated: ${socket.id} (user=${payload.sub})`);
        next();
      } catch (error) {
        const msg = (error as Error).message ?? 'Authentication failed';
        this.logger.warn(`WS auth rejected socket=${socket.id}: ${msg}`);
        next(new Error(msg));
      }
    });
  }

  handleConnection(client: Socket): void {
    this.logger.log(`WebSocket client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`WebSocket client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join:hospital')
  handleJoinHospital(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { hospitalId: string },
  ): void {
    const { hospitalId } = payload ?? {};

    if (!hospitalId) {
      client.emit('error', { message: 'hospitalId is required' });
      return;
    }

    const authorizedHospitals = client.data.hospitalIds ?? [];
    const isAdmin =
      client.data.role === 'admin' || client.data.role === 'super_admin';

    if (!isAdmin && !authorizedHospitals.includes(hospitalId)) {
      this.logger.warn(
        `Unauthorized room join attempt: socket=${client.id} user=${client.data.userId} hospitalId=${hospitalId}`,
      );
      client.emit('error', { message: 'Not authorized to join this hospital room' });
      return;
    }

    const roomName = `hospital:${hospitalId}`;
    client.join(roomName);
    this.logger.log(
      `Client ${client.id} (user=${client.data.userId}) joined room: ${roomName}`,
    );
    client.emit('joined', { hospitalId, room: roomName });
  }

  emitOrderUpdate(hospitalId: string, order: Partial<Order>): void {
    const roomName = `hospital:${hospitalId}`;
    this.server.to(roomName).emit('order:updated', order);
    this.logger.log(`Broadcasting order update to room: ${roomName}, order: ${order.id}`);
  }

  /** Kept for backward compatibility with OrdersService callers */
  emitOrderStatusUpdated(payload: OrderStatusUpdatedPayload): void {
    this.server.emit('order.status.updated', payload);
  }
}
