import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';

import { ApprovalService } from '../approvals/approval.service';
import { OutboxService } from '../events/outbox.service';
import { InventoryService } from '../inventory/inventory.service';
import { SlaService } from '../sla/sla.service';
import { SlaStage } from '../sla/enums/sla-stage.enum';

import { OrderEntity } from './entities/order.entity';
import { OrderStatus } from './enums/order-status.enum';
import { OrderEventType } from './enums/order-event-type.enum';
import { OrdersService } from './orders.service';
import { OrderEventStoreService } from './services/order-event-store.service';
import { OrderFeeService } from './services/order-fee.service';
import { RequestStatusService } from './services/request-status.service';
import { OrderStateMachine } from './state-machine/order-state-machine';

// ── Factories ─────────────────────────────────────────────────────────────────

const makeOrder = (overrides: Partial<OrderEntity> = {}): OrderEntity =>
  ({
    id: 'order-1',
    hospitalId: 'hosp-1',
    bloodBankId: 'bank-1',
    bloodType: 'O+',
    quantity: 2,
    deliveryAddress: '123 Main St',
    status: OrderStatus.PENDING,
    riderId: null,
    disputeId: null,
    disputeReason: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OrderEntity);

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockOrderRepo = {
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'order-new' })),
  save: jest.fn().mockImplementation((e) => Promise.resolve({ ...e, id: e.id ?? 'order-new' })),
  createQueryBuilder: jest.fn(),
};

const mockEventStore = {
  persistEvent: jest.fn().mockResolvedValue(undefined),
  replayOrderState: jest.fn().mockResolvedValue('PENDING'),
  getOrderHistory: jest.fn().mockResolvedValue([]),
};

const mockOutbox = {
  publishInTransaction: jest.fn().mockResolvedValue(undefined),
};

const mockInventory = {
  reserveStockOrThrow: jest.fn().mockResolvedValue(undefined),
  restoreStockOrThrow: jest.fn().mockResolvedValue(undefined),
};

const mockRequestStatus = {
  applyStatusUpdate: jest.fn().mockResolvedValue({ nextStatus: OrderStatus.CONFIRMED }),
};

const mockOrderFee = {
  computeAndPersist: jest.fn().mockResolvedValue(undefined),
  preview: jest.fn().mockResolvedValue({ totalFee: 120 }),
};

const mockApproval = {
  createRequest: jest.fn().mockResolvedValue({ id: 'approval-1' }),
};

const mockSla = {
  startStage: jest.fn().mockResolvedValue(undefined),
};

const mockDataSource = {
  transaction: jest.fn().mockImplementation((cb: (m: any) => Promise<any>) =>
    cb({
      save: jest.fn().mockImplementation((_, e) => Promise.resolve(e)),
      getRepository: jest.fn(),
    }),
  ),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('OrdersService', () => {
  let service: OrdersService;
  let mockGateway: { emitOrderUpdate: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create a mock gateway
    mockGateway = {
      emitOrderUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: getRepositoryToken(OrderEntity), useValue: mockOrderRepo },
        { provide: OrderStateMachine, useValue: new OrderStateMachine() },
        { provide: OrderEventStoreService, useValue: mockEventStore },
        { provide: OutboxService, useValue: mockOutbox },
        { provide: InventoryService, useValue: mockInventory },
        { provide: RequestStatusService, useValue: mockRequestStatus },
        { provide: OrderFeeService, useValue: mockOrderFee },
        { provide: ApprovalService, useValue: mockApproval },
        { provide: SlaService, useValue: mockSla },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  // ── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all orders when no filters provided', async () => {
      mockOrderRepo.find.mockResolvedValue([makeOrder()]);
      const result = await service.findAll();
      expect(result.data).toHaveLength(1);
    });

    it('filters by status', async () => {
      mockOrderRepo.find.mockResolvedValue([]);
      await service.findAll('PENDING');
      expect(mockOrderRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' } }),
      );
    });

    it('filters by hospitalId', async () => {
      mockOrderRepo.find.mockResolvedValue([]);
      await service.findAll(undefined, 'hosp-1');
      expect(mockOrderRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { hospitalId: 'hosp-1' } }),
      );
    });
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
      const mutableService = service as unknown as { orders: Order[] };
      mutableService.orders = mockOrders;
    });

    it('throws NotFoundException when order does not exist', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      hospitalId: 'hosp-1',
      bloodBankId: 'bank-1',
      bloodType: 'O+',
      quantity: 2,
      deliveryAddress: '123 Main St',
    };

    it('persists the order and reserves stock', async () => {
      const result = await service.create(dto as any);
      expect(result).toBeDefined();
      expect(mockInventory.reserveStockOrThrow).toHaveBeenCalled();
    });
  });

  // ── updateStatus (#1519 regression) ─────────────────────────────────────────

  describe('updateStatus', () => {
    it('delegates the status transition to RequestStatusService (#1519)', async () => {
      const order = makeOrder({ status: OrderStatus.PENDING });
      mockOrderRepo.findOne.mockResolvedValue(order);
      mockRequestStatus.applyStatusUpdate.mockResolvedValue({
        nextStatus: OrderStatus.CONFIRMED,
      });

      await service.updateStatus(order.id, OrderStatus.CONFIRMED, 'user-1');

      expect(mockRequestStatus.applyStatusUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: order.id, nextStatus: OrderStatus.CONFIRMED }),
      );
    });
  });
});
