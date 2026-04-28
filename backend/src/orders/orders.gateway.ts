import { Logger, UnauthorizedException } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WsException,
} from '@nestjs/websockets';

import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';

import { Order } from './types/order.types';

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
    hospitalIds?: string[];
    role?: string;
  };
}

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

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');

    server.use((socket: AuthenticatedSocket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace('Bearer ', '');

        if (!token) {
          this.logger.warn(
            `Connection attempt without token from ${socket.id}`,
          );
          return next(new Error('Authentication token required'));
        }

        const secret = this.configService.get<string>('JWT_SECRET');
        const payload = this.jwtService.verify<{
          sub: string;
          hospitalIds?: string[];
          role?: string;
        }>(token, { secret });

        socket.data.userId = payload.sub;
        socket.data.hospitalIds = payload.hospitalIds ?? [];
        socket.data.role = payload.role;

        this.logger.log(`Client authenticated: ${socket.id} (user=${payload.sub})`);
        next();
      } catch (error) {
        this.logger.error(`Authentication error: ${(error as Error).message}`);
        next(new Error('Authentication failed'));
      }
    });
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join:hospital')
  handleJoinHospital(
    client: AuthenticatedSocket,
    payload: { hospitalId: string },
  ): void {
    const { hospitalId } = payload;

    const authorizedHospitals = client.data.hospitalIds ?? [];
    const isAdmin = client.data.role === 'admin' || client.data.role === 'super_admin';

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
