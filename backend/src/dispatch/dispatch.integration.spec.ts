import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { DispatchService } from './dispatch.service';
import { RiderAssignmentService } from './rider-assignment.service';
import { OrderConfirmedEvent } from '../events';
import { RidersService } from '../riders/riders.service';
import { MapsService } from '../maps/maps.service';
import { ConfigService } from '@nestjs/config';

describe('DispatchService Integration Tests', () => {
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

    const module: TestingModule = await Test.createTestingModule({
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

    dispatchService = module.get<DispatchService>(DispatchService);
    riderAssignmentService = module.get<RiderAssignmentService>(RiderAssignmentService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Event-driven rider assignment', () => {
    it('should rank riders by weighted scoring on order.confirmed', async () => {
      ridersService.getAvailableRiders.mockResolvedValue({
        data: [
          {
            id: 'rider-a',
            name: 'A',
            status: 'available',
            latitude: 6.45,
            longitude: 3.4,
            activeDeliveries: 2,
            averageRating: 4.7,
          },
          {
            id: 'rider-b',
            name: 'B',
            status: 'available',
            latitude: 6.44,
            longitude: 3.42,
            activeDeliveries: 0,
            averageRating: 4.9,
          },
        ],
      });
      mapsService.getTravelTimeSeconds
        .mockResolvedValueOnce(900)
        .mockResolvedValueOnce(700);

      const event = new OrderConfirmedEvent(
        'order-123',
        'hospital-456',
        'A+',
        2,
        '123 Main St',
      );

      await riderAssignmentService.handleOrderConfirmed(event);

      const logs = await dispatchService.getAssignmentLogs('order-123');
      expect(logs.data[0].selectedRiderId).toBe('rider-b');
      expect(logs.data[0].status).toBe('pending');
    });

    it('should escalate to next candidate after timeout', async () => {
      jest.useFakeTimers();
      ridersService.getAvailableRiders.mockResolvedValue({
        data: [
          {
            id: 'rider-a',
            name: 'A',
            status: 'available',
            latitude: 6.45,
            longitude: 3.4,
            activeDeliveries: 0,
            averageRating: 4.5,
          },
          {
            id: 'rider-b',
            name: 'B',
            status: 'available',
            latitude: 6.44,
            longitude: 3.42,
            activeDeliveries: 1,
            averageRating: 4.8,
          },
        ],
      });
      mapsService.getTravelTimeSeconds
        .mockResolvedValueOnce(300)
        .mockResolvedValueOnce(1200);

      await riderAssignmentService.handleOrderConfirmed(
        new OrderConfirmedEvent(
          'order-timeout',
          'hospital-111',
          'O+',
          1,
          'Lekki',
        ),
      );

      await jest.advanceTimersByTimeAsync(11);

      const logs = await dispatchService.getAssignmentLogs('order-timeout');
      expect(logs.data.some((log: any) => log.status === 'timeout')).toBe(true);
      expect(
        logs.data.some(
          (log: any) => log.status === 'pending' && log.selectedRiderId === 'rider-b',
        ),
      ).toBe(true);
      jest.useRealTimers();
    });

    it('should emit assignment event when rider accepts', async () => {
      ridersService.getAvailableRiders.mockResolvedValue({
        data: [
          {
            id: 'rider-a',
            name: 'A',
            status: 'available',
            latitude: 6.45,
            longitude: 3.4,
            activeDeliveries: 1,
            averageRating: 4.6,
          },
        ],
      });
      mapsService.getTravelTimeSeconds.mockResolvedValue(600);

      const emitSpy = jest.spyOn(eventEmitter, 'emit');
      await riderAssignmentService.handleOrderConfirmed(
        new OrderConfirmedEvent(
          'order-accepted',
          'hospital-999',
          'AB+',
          1,
          'Yaba',
        ),
      );
      await dispatchService.respondToAssignment('order-accepted', 'rider-a', true);

      expect(emitSpy).toHaveBeenCalledWith(
        'order.rider.assigned',
        expect.objectContaining({
          orderId: 'order-accepted',
          riderId: 'rider-a',
        }),
      );
    });
  });
});
