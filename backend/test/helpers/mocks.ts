import { CompensationAction } from '../../src/common/errors/app-errors';

// ── Inventory ─────────────────────────────────────────────────────────────────

export const makeInventoryServiceMock = () => ({
  reserveStockOrThrow: jest.fn().mockResolvedValue(undefined),
  restoreStockOrThrow: jest.fn().mockResolvedValue(undefined),
  commitFulfillmentStockOrThrow: jest.fn().mockResolvedValue(undefined),
  releaseStockByBankAndType: jest.fn().mockResolvedValue(undefined),
  findByBankAndBloodType: jest.fn().mockResolvedValue(null),
  findAll: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
  findOne: jest.fn().mockResolvedValue({ data: null }),
  create: jest.fn().mockResolvedValue({ data: {} }),
  update: jest.fn().mockResolvedValue({ data: {} }),
  remove: jest.fn().mockResolvedValue({ data: {} }),
  updateStock: jest.fn().mockResolvedValue({ data: {} }),
  getLowStockItems: jest.fn().mockResolvedValue({ data: [] }),
});

// ── Soroban / blockchain ──────────────────────────────────────────────────────

export const makeSorobanServiceMock = () => ({
  submitTransactionAndWait: jest
    .fn()
    .mockResolvedValue({ transactionHash: 'tx-hash-abc' }),
  executeWithRetry: jest.fn().mockResolvedValue({ success: true }),
});

// ── Compensation ──────────────────────────────────────────────────────────────

export const makeCompensationServiceMock = () => ({
  compensate: jest.fn().mockResolvedValue({
    applied: [CompensationAction.REVERT_INVENTORY, CompensationAction.NOTIFY_USER],
    failed: [],
    failureRecordId: 'record-uuid',
  }),
});

// ── Email ─────────────────────────────────────────────────────────────────────

export const makeEmailProviderMock = () => ({
  send: jest.fn().mockResolvedValue(undefined),
});

// ── Notifications ─────────────────────────────────────────────────────────────

export const makeNotificationsServiceMock = () => ({
  send: jest.fn().mockResolvedValue([]),
  findForRecipient: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  markRead: jest.fn().mockResolvedValue({ data: {} }),
});

// ── Event emitter ─────────────────────────────────────────────────────────────

export const makeEventEmitterMock = () => ({
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
});

// ── Order event store ─────────────────────────────────────────────────────────

export const makeOrderEventStoreMock = () => ({
  persistEvent: jest.fn().mockResolvedValue(undefined),
  persistEventWithManager: jest.fn().mockResolvedValue(undefined),
  replayOrderState: jest.fn().mockResolvedValue('PENDING'),
  getOrderHistory: jest.fn().mockResolvedValue([]),
});

// ── Orders gateway ────────────────────────────────────────────────────────────

export const makeOrdersGatewayMock = () => ({
  emitOrderStatusUpdated: jest.fn(),
  emitOrderUpdate: jest.fn(),
});

// ── SLA service ───────────────────────────────────────────────────────────────

export const makeSlaServiceMock = () => ({
  startStage: jest.fn().mockResolvedValue(undefined),
  completeStage: jest.fn().mockResolvedValue(undefined),
  getRecord: jest.fn().mockResolvedValue(null),
});

// ── Approval service ──────────────────────────────────────────────────────────

export const makeApprovalServiceMock = () => ({
  createRequest: jest.fn().mockResolvedValue({ id: 'approval-1' }),
  approve: jest.fn().mockResolvedValue(undefined),
  reject: jest.fn().mockResolvedValue(undefined),
});

// ── Fee policy service ────────────────────────────────────────────────────────

export const makeFeePolicyServiceMock = () => ({
  previewFees: jest.fn().mockResolvedValue({
    appliedPolicyId: 'policy-1',
    baseFee: 100,
    totalFee: 120,
  }),
});

// ── Permissions service ───────────────────────────────────────────────────────

export const makePermissionsServiceMock = () => ({
  assertIsAdminOrSelf: jest.fn(),
  hasPermission: jest.fn().mockReturnValue(true),
});

// ── DataSource (transactional manager) ───────────────────────────────────────

export const makeDataSourceMock = () => ({
  transaction: jest.fn().mockImplementation((cb: (m: any) => Promise<any>) =>
    cb({
      save: jest.fn().mockImplementation((_, e) => Promise.resolve(e)),
      getRepository: jest.fn(),
    }),
  ),
});
