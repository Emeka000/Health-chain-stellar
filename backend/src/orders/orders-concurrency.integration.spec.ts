import { INestApplication } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';

import request from 'supertest';
import { App } from 'supertest/types';

import { InventoryStockEntity } from '../inventory/entities/inventory-stock.entity';
import { InventoryService } from '../inventory/inventory.service';

import { OrderEventEntity } from './entities/order-event.entity';
import { OrderEntity } from './entities/order.entity';
import { OrdersGateway } from './gateways/orders.gateway';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderEventStoreService } from './services/order-event-store.service';
import { RequestStatusService } from './services/request-status.service';
import { OrderStateMachine } from './state-machine/order-state-machine';

describe('Orders Inventory Concurrency Integration', () => {
  let app: INestApplication<App>;
  let inventoryService: InventoryService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          location: 'orders-concurrency-test',
          entities: [OrderEntity, OrderEventEntity, InventoryStockEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([
          OrderEntity,
          OrderEventEntity,
          InventoryStockEntity,
        ]),
        EventEmitterModule.forRoot(),
      ],
      controllers: [OrdersController],
      providers: [
        OrdersService,
        OrderStateMachine,
        OrderEventStoreService,
        RequestStatusService,
        InventoryService,
        {
          provide: OrdersGateway,
          useValue: {
            emitOrderStatusUpdated: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    inventoryService = app.get<InventoryService>(InventoryService);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('allows only one order when stock has one unit', async () => {
    await inventoryService.create({
      bloodBankId: 'BB-001',
      bloodType: 'O+',
      availableUnits: 1,
    });

    const payload = {
      hospitalId: 'HOSP-001',
      bloodBankId: 'BB-001',
      bloodType: 'O+',
      quantity: 1,
      deliveryAddress: '123 Main St',
    };

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer()).post('/orders').send(payload),
      request(app.getHttpServer()).post('/orders').send(payload),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const conflictResponse = [resA, resB].find((res) => res.status === 409);
    expect(conflictResponse).toBeDefined();
    expect(typeof conflictResponse?.body?.message).toBe('string');
    expect(conflictResponse?.body?.message.length).toBeGreaterThan(10);

    const stock = await inventoryService.findByBankAndBloodType('BB-001', 'O+');
    expect(stock).toBeTruthy();
    expect(stock?.availableUnits).toBe(0);
    expect(stock?.availableUnits).toBeGreaterThanOrEqual(0);
  });
});
