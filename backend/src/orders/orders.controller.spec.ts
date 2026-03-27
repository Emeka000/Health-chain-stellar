import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { InventoryService } from '../inventory/inventory.service';

import { OrderQueryParamsDto } from './dto/order-query-params.dto';
import { OrderEntity } from './entities/order.entity';
import { OrdersGateway } from './gateways/orders.gateway';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderEventStoreService } from './services/order-event-store.service';
import { RequestStatusService } from './services/request-status.service';
import { OrderStateMachine } from './state-machine/order-state-machine';

describe('OrdersController', () => {
  let controller: OrdersController;
  let service: OrdersService;
  let mockGateway: Partial<OrdersGateway>;

  beforeEach(async () => {
    // Create a mock gateway
    mockGateway = {
      emitOrderUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        OrdersService,
        {
          provide: getRepositoryToken(OrderEntity),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: OrderStateMachine,
          useValue: {},
        },
        {
          provide: OrderEventStoreService,
          useValue: {
            persistEvent: jest.fn(),
            replayOrderState: jest.fn(),
            getOrderHistory: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: InventoryService,
          useValue: {
            reserveStockOrThrow: jest.fn(),
          },
        },
        {
          provide: RequestStatusService,
          useValue: {
            applyStatusUpdate: jest.fn(),
          },
        },
        {
          provide: OrdersGateway,
          useValue: mockGateway,
        },
      ],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAllWithFilters', () => {
    it('should return paginated orders', async () => {
      const params: OrderQueryParamsDto = {
        hospitalId: 'HOSP-001',
        page: 1,
        pageSize: 25,
      };

      const result = {
        data: [],
        pagination: {
          currentPage: 1,
          pageSize: 25,
          totalCount: 0,
          totalPages: 0,
        },
      };

      jest.spyOn(service, 'findAllWithFilters').mockResolvedValue(result);

      expect(await controller.findAllWithFilters(params)).toBe(result);
    });

    it('should throw BadRequestException when startDate is after endDate', async () => {
      const params: OrderQueryParamsDto = {
        hospitalId: 'HOSP-001',
        startDate: '2024-12-31',
        endDate: '2024-01-01',
        page: 1,
        pageSize: 25,
      };

      await expect(controller.findAllWithFilters(params)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should accept valid date range', async () => {
      const params: OrderQueryParamsDto = {
        hospitalId: 'HOSP-001',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        page: 1,
        pageSize: 25,
      };

      const result = {
        data: [],
        pagination: {
          currentPage: 1,
          pageSize: 25,
          totalCount: 0,
          totalPages: 0,
        },
      };

      jest.spyOn(service, 'findAllWithFilters').mockResolvedValue(result);

      expect(await controller.findAllWithFilters(params)).toBe(result);
    });

    it('should accept all filter parameters', async () => {
      const params: OrderQueryParamsDto = {
        hospitalId: 'HOSP-001',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        bloodTypes: 'A+,O-',
        statuses: 'pending,confirmed',
        bloodBank: 'Central',
        sortBy: 'placedAt',
        sortOrder: 'desc',
        page: 1,
        pageSize: 50,
      };

      const result = {
        data: [],
        pagination: {
          currentPage: 1,
          pageSize: 50,
          totalCount: 0,
          totalPages: 0,
        },
      };

      jest.spyOn(service, 'findAllWithFilters').mockResolvedValue(result);

      expect(await controller.findAllWithFilters(params)).toBe(result);
      expect(service.findAllWithFilters).toHaveBeenCalledWith(params);
    });
  });
});
