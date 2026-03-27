import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { InventoryService } from '../inventory/inventory.service';

import { OrderEntity } from './entities/order.entity';
import { OrdersGateway } from './gateways/orders.gateway';
import { OrdersService } from './orders.service';
import { OrderEventStoreService } from './services/order-event-store.service';
import { RequestStatusService } from './services/request-status.service';
import { OrderStateMachine } from './state-machine/order-state-machine';
import { Order, BloodType, OrderStatus } from './types/order.types';

describe('OrdersService', () => {
  let service: OrdersService;
  let mockGateway: Partial<OrdersGateway>;

  beforeEach(async () => {
    // Create a mock gateway
    mockGateway = {
      emitOrderUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
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

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllWithFilters', () => {
    beforeEach(() => {
      // Setup mock data
      const mockOrders: Order[] = [
        {
          id: 'ORD-001',
          bloodType: 'A+',
          quantity: 5,
          bloodBank: {
            id: 'BB-001',
            name: 'Central Blood Bank',
            location: 'Lagos',
          },
          hospital: {
            id: 'HOSP-001',
            name: 'General Hospital',
            location: 'Ikeja',
          },
          status: 'pending',
          rider: null,
          placedAt: new Date('2024-01-15T10:00:00Z'),
          deliveredAt: null,
          confirmedAt: null,
          cancelledAt: null,
          createdAt: new Date('2024-01-15T10:00:00Z'),
          updatedAt: new Date('2024-01-15T10:00:00Z'),
        },
        {
          id: 'ORD-002',
          bloodType: 'O-',
          quantity: 3,
          bloodBank: {
            id: 'BB-002',
            name: 'City Blood Bank',
            location: 'Abuja',
          },
          hospital: {
            id: 'HOSP-001',
            name: 'General Hospital',
            location: 'Ikeja',
          },
          status: 'delivered',
          rider: { id: 'RIDER-001', name: 'John Doe', phone: '+234-XXX-XXXX' },
          placedAt: new Date('2024-01-10T10:00:00Z'),
          deliveredAt: new Date('2024-01-10T14:00:00Z'),
          confirmedAt: new Date('2024-01-10T10:05:00Z'),
          cancelledAt: null,
          createdAt: new Date('2024-01-10T10:00:00Z'),
          updatedAt: new Date('2024-01-10T14:00:00Z'),
        },
        {
          id: 'ORD-003',
          bloodType: 'B+',
          quantity: 2,
          bloodBank: {
            id: 'BB-001',
            name: 'Central Blood Bank',
            location: 'Lagos',
          },
          hospital: {
            id: 'HOSP-002',
            name: 'City Hospital',
            location: 'Lagos',
          },
          status: 'confirmed',
          rider: null,
          placedAt: new Date('2024-01-20T10:00:00Z'),
          deliveredAt: null,
          confirmedAt: new Date('2024-01-20T10:05:00Z'),
          cancelledAt: null,
          createdAt: new Date('2024-01-20T10:00:00Z'),
          updatedAt: new Date('2024-01-20T10:05:00Z'),
        },
      ];

      // Inject mock data into service
      (service as any).orders = mockOrders;
    });

    it('should filter orders by hospital ID', async () => {
      const result = await service.findAllWithFilters({
        hospitalId: 'HOSP-001',
        page: 1,
        pageSize: 25,
      });

      expect(result.data).toHaveLength(2);
      expect(
        result.data.every((order) => order.hospital.id === 'HOSP-001'),
      ).toBe(true);
      expect(result.pagination.totalCount).toBe(2);
    });

    it('should filter orders by date range', async () => {
      const result = await service.findAllWithFilters({
        hospitalId: 'HOSP-001',
        startDate: '2024-01-12T00:00:00Z',
        endDate: '2024-01-20T23:59:59Z',
        page: 1,
        pageSize: 25,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('ORD-001');
    });

    it('should filter orders by blood type', async () => {
      const result = await service.findAllWithFilters({
        hospitalId: 'HOSP-001',
        bloodTypes: 'A+',
        page: 1,
        pageSize: 25,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].bloodType).toBe('A+');
    });

    it('should filter orders by multiple blood types', async () => {
      const result = await service.findAllWithFilters({
        hospitalId: 'HOSP-001',
        bloodTypes: 'A+,O-',
        page: 1,
        pageSize: 25,
      });

      expect(result.data).toHaveLength(2);
      expect(result.data.map((o) => o.bloodType).sort()).toEqual(['A+', 'O-']);
    });

    it('should filter orders by status', async () => {
      const result = await service.findAllWithFilters({
        hospitalId: 'HOSP-001',
        statuses: 'pending',
        page: 1,
        pageSize: 25,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe('pending');
    });

    it('should filter orders by blood bank name (case-insensitive)', async () => {
      const result = await service.findAllWithFilters({
        hospitalId: 'HOSP-001',
        bloodBank: 'central',
        page: 1,
        pageSize: 25,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].bloodBank.name).toBe('Central Blood Bank');
    });

    it('should prioritize active orders before completed orders', async () => {
      const result = await service.findAllWithFilters({
        hospitalId: 'HOSP-001',
        sortBy: 'placedAt',
        sortOrder: 'asc',
        page: 1,
        pageSize: 25,
      });

      expect(result.data).toHaveLength(2);
      // Active order (pending) should come first despite earlier date on delivered order
      expect(result.data[0].status).toBe('pending');
      expect(result.data[1].status).toBe('delivered');
    });

    it('should paginate results correctly', async () => {
      const result = await service.findAllWithFilters({
        hospitalId: 'HOSP-001',
        page: 1,
        pageSize: 1,
      });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.currentPage).toBe(1);
      expect(result.pagination.pageSize).toBe(1);
      expect(result.pagination.totalCount).toBe(2);
      expect(result.pagination.totalPages).toBe(2);
    });

    it('should return second page of results', async () => {
      const result = await service.findAllWithFilters({
        hospitalId: 'HOSP-001',
        page: 2,
        pageSize: 1,
      });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.currentPage).toBe(2);
    });

    it('should sort by quantity in ascending order', async () => {
      const result = await service.findAllWithFilters({
        hospitalId: 'HOSP-001',
        sortBy: 'quantity',
        sortOrder: 'asc',
        page: 1,
        pageSize: 25,
      });

      expect(result.data).toHaveLength(2);
      // Active order comes first, but within active orders, sorted by quantity
      expect(result.data[0].quantity).toBe(5); // pending (active)
      expect(result.data[1].quantity).toBe(3); // delivered (completed)
    });

    it('should apply multiple filters simultaneously', async () => {
      const result = await service.findAllWithFilters({
        hospitalId: 'HOSP-001',
        bloodTypes: 'A+,O-',
        statuses: 'pending,delivered',
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-31T23:59:59Z',
        page: 1,
        pageSize: 25,
      });

      expect(result.data).toHaveLength(2);
      expect(result.data.every((o) => ['A+', 'O-'].includes(o.bloodType))).toBe(
        true,
      );
      expect(
        result.data.every((o) => ['pending', 'delivered'].includes(o.status)),
      ).toBe(true);
    });
  });
});
