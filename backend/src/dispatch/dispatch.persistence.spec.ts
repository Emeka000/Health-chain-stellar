import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { OrderCancelledEvent, OrderRiderAssignedEvent, OrderStatusUpdatedEvent } from '../events';
import { NotificationsService } from '../notifications/notifications.service';
import { MapsService } from '../maps/maps.service';
import { RidersService } from '../riders/riders.service';
import { PolicyCenterService } from '../policy-center/policy-center.service';
import { ConfigService } from '@nestjs/config';

import { DispatchService } from './dispatch.service';
import { RiderAssignmentService } from './rider-assignment.service';
import {
  DispatchRecord,
  DispatchStatus,
  DispatchStatusHistory,
} from './entities/dispatch-record.entity';

const makeRepo = <T>(overrides: Partial<Repository<T>> = {}): jest.Mocked<Repository<T>> =>
  ({
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve({ id: 'dispatch-1', ...v })),
    remove: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<Repository<T>>);

describe('DispatchService — persistence & state machine', () => {
  let service: DispatchService;
  let dispatchRepo: jest.Mocked<Repository<DispatchRecord>>;
  let historyRepo: jest.Mocked<Repository<DispatchStatusHistory>>;
  let redis: { set: jest.Mock; get: jest.Mock };

  const baseDispatch = (): DispatchRecord =>
    ({
      id: 'dispatch-1',
      orderId: 'order-1',
      riderId: null,
      status: DispatchStatus.PENDING,
      cancelReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      history: [],
    } as DispatchRecord);

  beforeEach(async () => {
    dispatchRepo = makeRepo<DispatchRecord>();
    historyRepo = makeRepo<DispatchStatusHistory>();
    redis = { set: jest.fn().mockResolvedValue('OK'), get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        DispatchService,
        RiderAssignmentService,
        { provide: getRepositoryToken(DispatchRecord), useValue: dispatchRepo },
        { provide: getRepositoryToken(DispatchStatusHistory), useValue: historyRepo },
        { provide: getRepositoryToken('BloodUnit'), useValue: makeRepo() },
        { provide: getRepositoryToken('OrderEntity'), useValue: makeRepo() },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: NotificationsService, useValue: { send: jest.fn() } },
        { provide: RidersService, useValue: { getAvailableRiders: jest.fn().mockResolvedValue({ data: [] }) } },
        { provide: MapsService, useValue: { getTravelTimeSeconds: jest.fn() } },
        { provide: PolicyCenterService, useValue: { getActivePolicySnapshot: jest.fn().mockRejectedValue(new Error()) } },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d: unknown) => d },
        },
      ],
    }).compile();

    service = module.get(DispatchService);
  });

  // --- CRUD ---

  it('create persists a new dispatch record and appends PENDING history', async () => {
    const result = await service.create({ orderId: 'order-1' });
    expect(dispatchRepo.save).toHaveBeenCalled();
    expect(historyRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: DispatchStatus.PENDING }),
    );
    expect(result.data).toBeDefined();
  });

  it('findOne returns 404 for unknown id', async () => {
    dispatchRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne('unknown-id')).rejects.toThrow(NotFoundException);
  });

  it('findOne returns dispatch with history for known id', async () => {
    const dispatch = baseDispatch();
    dispatchRepo.findOne.mockResolvedValue(dispatch);
    const result = await service.findOne('dispatch-1');
    expect(result.data).toEqual(dispatch);
  });

  it('update transitions PENDING → ASSIGNED when riderId is set', async () => {
    const dispatch = baseDispatch();
    dispatchRepo.findOne.mockResolvedValue(dispatch);
    dispatchRepo.save.mockResolvedValue({ ...dispatch, status: DispatchStatus.ASSIGNED, riderId: 'rider-1' });

    await service.update('dispatch-1', { riderId: 'rider-1' });

    expect(dispatchRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: DispatchStatus.ASSIGNED }),
    );
    expect(historyRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: DispatchStatus.ASSIGNED }),
    );
  });

  // --- State transitions ---

  it('completeDispatch transitions IN_TRANSIT → COMPLETED', async () => {
    const dispatch = { ...baseDispatch(), status: DispatchStatus.IN_TRANSIT };
    dispatchRepo.findOne.mockResolvedValue(dispatch);
    dispatchRepo.save.mockResolvedValue({ ...dispatch, status: DispatchStatus.COMPLETED });

    const result = await service.completeDispatch('dispatch-1');
    expect(result.data.status).toBe(DispatchStatus.COMPLETED);
    expect(historyRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: DispatchStatus.COMPLETED }),
    );
  });

  it('completeDispatch returns 422 for invalid transition (CANCELLED → COMPLETED)', async () => {
    const dispatch = { ...baseDispatch(), status: DispatchStatus.CANCELLED };
    dispatchRepo.findOne.mockResolvedValue(dispatch);

    await expect(service.completeDispatch('dispatch-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('cancelDispatch transitions PENDING → CANCELLED with reason', async () => {
    const dispatch = baseDispatch();
    dispatchRepo.findOne.mockResolvedValue(dispatch);
    dispatchRepo.save.mockResolvedValue({ ...dispatch, status: DispatchStatus.CANCELLED });

    const result = await service.cancelDispatch('dispatch-1', 'no rider available');
    expect(result.data.status).toBe(DispatchStatus.CANCELLED);
    expect(historyRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: DispatchStatus.CANCELLED, note: 'no rider available' }),
    );
  });

  it('cancelDispatch returns 422 for COMPLETED dispatch', async () => {
    const dispatch = { ...baseDispatch(), status: DispatchStatus.COMPLETED };
    dispatchRepo.findOne.mockResolvedValue(dispatch);

    await expect(service.cancelDispatch('dispatch-1', 'reason')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  // --- Event-driven transitions ---

  it('handleOrderCancelled cancels dispatch and appends history', async () => {
    const dispatch = baseDispatch();
    dispatchRepo.findOne.mockResolvedValue(dispatch);
    dispatchRepo.save.mockResolvedValue({ ...dispatch, status: DispatchStatus.CANCELLED });

    await service.handleOrderCancelled(
      new OrderCancelledEvent('order-1', 'hospital-1', 'test reason'),
    );

    expect(dispatchRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: DispatchStatus.CANCELLED }),
    );
    expect(historyRepo.save).toHaveBeenCalled();
  });

  it('handleOrderCancelled is a no-op for duplicate events (Redis dedup)', async () => {
    redis.set.mockResolvedValue(null); // NX fails → duplicate
    const dispatch = baseDispatch();
    dispatchRepo.findOne.mockResolvedValue(dispatch);

    await service.handleOrderCancelled(
      new OrderCancelledEvent('order-1', 'hospital-1', 'reason'),
    );

    expect(dispatchRepo.save).not.toHaveBeenCalled();
  });

  it('handleOrderRiderAssigned creates dispatch if none exists and transitions to ASSIGNED', async () => {
    dispatchRepo.findOne.mockResolvedValue(null);
    const created = baseDispatch();
    dispatchRepo.save.mockResolvedValueOnce(created); // create
    dispatchRepo.save.mockResolvedValueOnce({ ...created, status: DispatchStatus.ASSIGNED }); // assign

    await service.handleOrderRiderAssigned(
      new OrderRiderAssignedEvent('order-1', 'rider-1'),
    );

    expect(dispatchRepo.save).toHaveBeenCalledTimes(2);
  });

  it('handleOrderStatusUpdated maps DELIVERED → COMPLETED on dispatch', async () => {
    const dispatch = { ...baseDispatch(), status: DispatchStatus.IN_TRANSIT };
    dispatchRepo.findOne.mockResolvedValue(dispatch);
    dispatchRepo.save.mockResolvedValue({ ...dispatch, status: DispatchStatus.COMPLETED });

    await service.handleOrderStatusUpdated(
      new OrderStatusUpdatedEvent('order-1', 'IN_TRANSIT', 'DELIVERED'),
    );

    expect(dispatchRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: DispatchStatus.COMPLETED }),
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-instance deduplication simulation (issue #526)
// ---------------------------------------------------------------------------
describe('DispatchService — cross-instance Redis deduplication', () => {
  const buildService = async (redisSet: jest.Mock) => {
    const dispatchRepo = makeRepo<DispatchRecord>();
    const historyRepo = makeRepo<DispatchStatusHistory>();
    dispatchRepo.findOne.mockResolvedValue({
      id: 'dispatch-1',
      orderId: 'order-1',
      riderId: null,
      status: DispatchStatus.PENDING,
      cancelReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      history: [],
    } as DispatchRecord);

    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        DispatchService,
        RiderAssignmentService,
        { provide: getRepositoryToken(DispatchRecord), useValue: dispatchRepo },
        { provide: getRepositoryToken(DispatchStatusHistory), useValue: historyRepo },
        { provide: getRepositoryToken('BloodUnit'), useValue: makeRepo() },
        { provide: getRepositoryToken('OrderEntity'), useValue: makeRepo() },
        { provide: REDIS_CLIENT, useValue: { set: redisSet } },
        { provide: NotificationsService, useValue: { send: jest.fn() } },
        { provide: RidersService, useValue: { getAvailableRiders: jest.fn().mockResolvedValue({ data: [] }) } },
        { provide: MapsService, useValue: { getTravelTimeSeconds: jest.fn() } },
        { provide: PolicyCenterService, useValue: { getActivePolicySnapshot: jest.fn().mockRejectedValue(new Error()) } },
        { provide: ConfigService, useValue: { get: (_k: string, d: unknown) => d } },
      ],
    }).compile();

    return { service: module.get(DispatchService), dispatchRepo };
  };

  it('two instances processing the same event: only the first proceeds', async () => {
    const timestamp = new Date();
    const event = new OrderCancelledEvent('order-x', 'hospital-x', 'dup-test', timestamp);

    // Simulate shared Redis: first SET NX returns OK, second returns null
    let callCount = 0;
    const sharedSet = jest.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? 'OK' : null);
    });

    const { service: svc1, dispatchRepo: repo1 } = await buildService(sharedSet);
    const { service: svc2, dispatchRepo: repo2 } = await buildService(sharedSet);

    await Promise.all([svc1.handleOrderCancelled(event), svc2.handleOrderCancelled(event)]);

    const totalSaves = (repo1.save as jest.Mock).mock.calls.length +
      (repo2.save as jest.Mock).mock.calls.length;
    expect(totalSaves).toBe(1);
  });
});
