import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { DispatchService } from './dispatch.service';
import { RiderAssignmentService } from './rider-assignment.service';
import { OrderConfirmedEvent } from '../events';
import { RidersService } from '../riders/riders.service';
import { MapsService } from '../maps/maps.service';
import { ConfigService } from '@nestjs/config';

describe('Dispatch Event Integration (E2E)', () => {
  let app: INestApplication;
  let dispatchService: DispatchService;
  let riderAssignmentService: RiderAssignmentService;
  let eventEmitter: EventEmitter2;
  let ridersService: { getAvailableRiders: jest.Mock };
  let mapsService: { getTravelTimeSeconds: jest.Mock };

  beforeEach(async () => {
    ridersService = {
      getAvailableRiders: jest.fn(),
    };
    mapsService = {
      getTravelTimeSeconds: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        DispatchService,
        RiderAssignmentService,
        { provide: RidersService, useValue: ridersService },
        { provide: MapsService, useValue: mapsService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue: number) => {
              if (key === 'ASSIGNMENT_ACCEPTANCE_TIMEOUT_MS') return 10;
              if (key === 'ASSIGNMENT_DISTANCE_WEIGHT') return 0.5;
              if (key === 'ASSIGNMENT_WORKLOAD_WEIGHT') return 0.3;
              if (key === 'ASSIGNMENT_RATING_WEIGHT') return 0.2;
              return defaultValue;
            },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dispatchService = app.get<DispatchService>(DispatchService);
    riderAssignmentService = app.get<RiderAssignmentService>(RiderAssignmentService);
    eventEmitter = app.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await app.close();
  });

  it('triggers assignment workflow on order.confirmed event', async () => {
    ridersService.getAvailableRiders.mockResolvedValue({
      data: [
        {
          id: 'rider-100',
          name: 'Alpha',
          status: 'available',
          latitude: 6.5,
          longitude: 3.3,
          activeDeliveries: 0,
          averageRating: 4.8,
        },
      ],
    });
    mapsService.getTravelTimeSeconds.mockResolvedValue(450);

    await eventEmitter.emitAsync(
      'order.confirmed',
      new OrderConfirmedEvent(
        'order-100',
        'hospital-100',
        'B+',
        2,
        'Victoria Island',
      ),
    );

    const logs = await dispatchService.getAssignmentLogs('order-100');
    expect(logs.data).toHaveLength(1);
    expect(logs.data[0].selectedRiderId).toBe('rider-100');
    expect(logs.data[0].status).toBe('pending');
  });

  it('serves assignment logs with order filter', async () => {
    ridersService.getAvailableRiders.mockResolvedValue({
      data: [
        {
          id: 'rider-200',
          name: 'Beta',
          status: 'available',
          latitude: 6.52,
          longitude: 3.31,
          activeDeliveries: 1,
          averageRating: 4.7,
        },
      ],
    });
    mapsService.getTravelTimeSeconds.mockResolvedValue(620);

    await riderAssignmentService.handleOrderConfirmed(
      new OrderConfirmedEvent(
        'order-200',
        'hospital-200',
        'O-',
        1,
        'Ikeja',
      ),
    );

    const filtered = await dispatchService.getAssignmentLogs('order-200');
    const all = await dispatchService.getAssignmentLogs();

    expect(filtered.data.every((log: any) => log.orderId === 'order-200')).toBe(true);
    expect(all.data.length).toBeGreaterThanOrEqual(filtered.data.length);
  });
});
