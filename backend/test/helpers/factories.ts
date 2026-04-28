import { BloodRequestEntity } from '../../src/blood-requests/entities/blood-request.entity';
import { BloodRequestItemEntity } from '../../src/blood-requests/entities/blood-request-item.entity';
import { BloodRequestStatus } from '../../src/blood-requests/enums/blood-request-status.enum';
import { OrderEntity } from '../../src/orders/entities/order.entity';
import { OrderStatus } from '../../src/orders/enums/order-status.enum';
import { InventoryStockEntity } from '../../src/inventory/entities/inventory-stock.entity';

// ── Request user ──────────────────────────────────────────────────────────────

export const makeAdminUser = (
  overrides: Partial<{ id: string; role: string; email: string }> = {},
) => ({
  id: 'user-admin',
  role: 'admin',
  email: 'admin@test.com',
  ...overrides,
});

export const makeHospitalUser = (
  overrides: Partial<{ id: string; role: string; email: string }> = {},
) => ({
  id: 'hosp-1',
  role: 'HOSPITAL',
  email: 'hospital@test.com',
  ...overrides,
});

// ── Blood request ─────────────────────────────────────────────────────────────

export const makeBloodRequestItem = (
  overrides: Partial<BloodRequestItemEntity> = {},
): BloodRequestItemEntity =>
  ({
    id: 'item-1',
    bloodType: 'A+',
    component: 'WHOLE_BLOOD',
    quantityMl: 450,
    priority: 'NORMAL',
    compatibilityNotes: null,
    ...overrides,
  } as BloodRequestItemEntity);

export const makeBloodRequest = (
  overrides: Partial<BloodRequestEntity> = {},
): BloodRequestEntity =>
  ({
    id: 'req-uuid',
    requestNumber: 'BR-123456-ABC',
    hospitalId: 'hosp-1',
    requiredByTimestamp: Math.floor((Date.now() + 86400000) / 1000),
    createdTimestamp: Math.floor(Date.now() / 1000),
    urgency: 'ROUTINE',
    deliveryAddress: '123 Main St',
    notes: null,
    status: BloodRequestStatus.PENDING,
    blockchainTxHash: 'tx-hash-abc',
    createdByUserId: 'user-admin',
    items: [makeBloodRequestItem()],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BloodRequestEntity);

export const makeCreateBloodRequestDto = (
  overrides: Partial<{
    hospitalId: string;
    requiredBy: string;
    deliveryAddress: string;
    notes: string | null;
    urgency: string;
    items: Array<{
      bloodBankId: string;
      bloodType: string;
      quantity: number;
      quantityMl?: number;
    }>;
  }> = {},
) => ({
  hospitalId: 'hosp-1',
  requiredBy: new Date(Date.now() + 86400000).toISOString(),
  deliveryAddress: '123 Main St',
  notes: null,
  urgency: 'ROUTINE',
  items: [{ bloodBankId: 'bank-1', bloodType: 'A+', quantity: 450 }],
  ...overrides,
});

// ── Order ─────────────────────────────────────────────────────────────────────

export const makeOrder = (overrides: Partial<OrderEntity> = {}): OrderEntity =>
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
    feeBreakdown: null,
    appliedPolicyId: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OrderEntity);

export const makeCreateOrderDto = (
  overrides: Partial<{
    hospitalId: string;
    bloodBankId: string;
    bloodType: string;
    quantity: number;
    deliveryAddress: string;
  }> = {},
) => ({
  hospitalId: 'hosp-1',
  bloodBankId: 'bank-1',
  bloodType: 'O+',
  quantity: 2,
  deliveryAddress: '123 Main St',
  ...overrides,
});

// ── Inventory ─────────────────────────────────────────────────────────────────

export const makeInventoryStock = (
  overrides: Partial<InventoryStockEntity> = {},
): InventoryStockEntity =>
  ({
    id: 'stock-1',
    bloodBankId: 'bank-1',
    bloodType: 'O+',
    availableUnitsMl: 1000,
    reservedUnitsMl: 0,
    allocatedUnitsMl: 0,
    totalUnitsMl: 1000,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as InventoryStockEntity);

// ── Mock repository builder ───────────────────────────────────────────────────

export const makeMockRepo = <T>(defaults: Partial<T> = {}) => ({
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockResolvedValue([]),
  findAndCount: jest.fn().mockResolvedValue([[], 0]),
  create: jest.fn().mockImplementation((dto: Partial<T>) => ({ ...defaults, ...dto })),
  save: jest.fn().mockImplementation((e: T) => Promise.resolve(e)),
  merge: jest.fn().mockImplementation((e: T, u: Partial<T>) => ({ ...e, ...u })),
  remove: jest.fn().mockResolvedValue(undefined),
  exist: jest.fn().mockResolvedValue(false),
  createQueryBuilder: jest.fn(),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
});

export const makeQb = (overrides: Record<string, jest.Mock> = {}) => {
  const qb: Record<string, jest.Mock> = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  return qb;
};
