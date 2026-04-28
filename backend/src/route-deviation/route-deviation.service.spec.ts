import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { RouteDeviationDetectedEvent } from '../events/route-deviation-detected.event';

import { PlannedRouteEntity } from './entities/planned-route.entity';
import {
  DeviationSeverity,
  DeviationStatus,
  RouteDeviationIncidentEntity,
} from './entities/route-deviation-incident.entity';
import { RouteDeviationService } from './route-deviation.service';

// Minimal encoded polyline: two points ~1km apart in Lagos
// Point A: 6.5244, 3.3792  Point B: 6.5244, 3.3882
const STRAIGHT_POLYLINE = 'mfnFkxhV??_@??';

function makePlannedRoute(
  overrides: Partial<PlannedRouteEntity> = {},
): PlannedRouteEntity {
  return {
    id: 'route-1',
    orderId: 'order-1',
    riderId: 'rider-1',
    polyline: STRAIGHT_POLYLINE,
    checkpoints: [],
    corridorRadiusM: 300,
    maxDeviationSeconds: 60,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PlannedRouteEntity;
}

describe('RouteDeviationService', () => {
  let service: RouteDeviationService;
  let plannedRouteRepo: Record<string, jest.Mock>;
  let incidentRepo: Record<string, jest.Mock>;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    plannedRouteRepo = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      create: jest.fn((dto) => ({ ...dto })),

      save: jest.fn((e) => Promise.resolve({ id: 'route-1', ...e })),
      update: jest.fn(() => Promise.resolve(undefined)),
      findOne: jest.fn(() => Promise.resolve(null)),
    };

    incidentRepo = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      create: jest.fn((dto) => ({ ...dto })),

      save: jest.fn((e) => Promise.resolve({ id: 'incident-1', ...e })),
      update: jest.fn(() => Promise.resolve(undefined)),
      findOne: jest.fn(() => Promise.resolve(null)),
      find: jest.fn(() => Promise.resolve([])),
    };

    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouteDeviationService,
        {
          provide: getRepositoryToken(PlannedRouteEntity),
          useValue: plannedRouteRepo,
        },
        {
          provide: getRepositoryToken(RouteDeviationIncidentEntity),
          useValue: incidentRepo,
        },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(RouteDeviationService);
  });

  describe('createPlannedRoute', () => {
    it('deactivates existing routes and saves new one', async () => {
      const result = await service.createPlannedRoute({
        orderId: 'order-1',
        riderId: 'rider-1',
        polyline: STRAIGHT_POLYLINE,
      });

      expect(plannedRouteRepo.update).toHaveBeenCalledWith(
        { orderId: 'order-1', isActive: true },
        { isActive: false },
      );
      expect(plannedRouteRepo.save).toHaveBeenCalled();
      expect(result.orderId).toBe('order-1');
    });

    it('applies default corridor radius and deviation seconds', async () => {
      await service.createPlannedRoute({
        orderId: 'order-1',
        riderId: 'rider-1',
        polyline: STRAIGHT_POLYLINE,
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const created = plannedRouteRepo.create.mock.calls[0][0] as {
        corridorRadiusM: number;
        maxDeviationSeconds: number;
      };
      expect(created.corridorRadiusM).toBe(300);
      expect(created.maxDeviationSeconds).toBe(120);
    });

    it('respects custom corridor radius', async () => {
      await service.createPlannedRoute({
        orderId: 'order-1',
        riderId: 'rider-1',
        polyline: STRAIGHT_POLYLINE,
        corridorRadiusM: 500,
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const created = plannedRouteRepo.create.mock.calls[0][0] as {
        corridorRadiusM: number;
      };
      expect(created.corridorRadiusM).toBe(500);
    });
  });

  describe('ingestLocationUpdate', () => {
    it('does nothing when no active planned route exists', async () => {
      plannedRouteRepo.findOne.mockResolvedValue(null);

      await service.ingestLocationUpdate({
        riderId: 'rider-1',
        orderId: 'order-1',
        latitude: 6.5244,
        longitude: 3.3792,
      });

      expect(incidentRepo.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('does not create incident when rider is on corridor', async () => {
      // Use a simple polyline with two identical points so distance = 0
      const route = makePlannedRoute({ polyline: 'mfnFkxhV' }); // single point at 6.5244,3.3792
      plannedRouteRepo.findOne.mockResolvedValue(route);

      await service.ingestLocationUpdate({
        riderId: 'rider-1',
        orderId: 'order-1',
        latitude: 6.5244,
        longitude: 3.3792, // exactly on the point
      });

      expect(incidentRepo.save).not.toHaveBeenCalled();
    });

    it('does not create incident on first off-corridor ping (duration not met)', async () => {
      const route = makePlannedRoute({
        polyline: 'mfnFkxhV',
        corridorRadiusM: 10,
      });
      plannedRouteRepo.findOne.mockResolvedValue(route);

      // Far from the single point
      await service.ingestLocationUpdate({
        riderId: 'rider-1',
        orderId: 'order-1',
        latitude: 6.6,
        longitude: 3.5,
      });

      expect(incidentRepo.save).not.toHaveBeenCalled();
    });

    it('creates incident after duration threshold is exceeded', async () => {
      const route = makePlannedRoute({
        polyline: 'mfnFkxhV',
        corridorRadiusM: 10,
        maxDeviationSeconds: 0, // threshold = 0 so second ping triggers
      });
      plannedRouteRepo.findOne.mockResolvedValue(route);
      incidentRepo.findOne.mockResolvedValue(null);

      const dto = {
        riderId: 'rider-1',
        orderId: 'order-1',
        latitude: 6.6,
        longitude: 3.5,
      };

      // First ping — sets off-corridor state
      await service.ingestLocationUpdate(dto);
      // Second ping — duration >= 0, should create incident
      await service.ingestLocationUpdate(dto);

      expect(incidentRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'route.deviation.detected',
        expect.any(RouteDeviationDetectedEvent),
      );
    });

    it('updates existing open incident instead of creating a new one', async () => {
      const route = makePlannedRoute({
        polyline: 'mfnFkxhV',
        corridorRadiusM: 10,
        maxDeviationSeconds: 0,
      });
      plannedRouteRepo.findOne.mockResolvedValue(route);

      const existingIncident = {
        id: 'incident-existing',
        orderId: 'order-1',
        riderId: 'rider-1',
        status: DeviationStatus.OPEN,
        deviationDistanceM: 100,
        deviationDurationS: 10,
        lastKnownLatitude: 6.6,
        lastKnownLongitude: 3.5,
        severity: DeviationSeverity.MINOR,
        recommendedAction: '',
      };
      incidentRepo.findOne.mockResolvedValue(existingIncident);

      const dto = {
        riderId: 'rider-1',
        orderId: 'order-1',
        latitude: 6.6,
        longitude: 3.5,
      };
      await service.ingestLocationUpdate(dto);
      await service.ingestLocationUpdate(dto);

      // save called for update, not create
      expect(incidentRepo.create).not.toHaveBeenCalled();
      expect(incidentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'incident-existing' }),
      );
    });
  });

  describe('acknowledgeIncident', () => {
    it('sets acknowledgedAt and status', async () => {
      const incident = {
        id: 'inc-1',
        status: DeviationStatus.OPEN,
        acknowledgedAt: null,
        acknowledgedBy: null,
      };
      incidentRepo.findOne.mockResolvedValue(incident);
      incidentRepo.save.mockResolvedValue({
        ...incident,
        status: DeviationStatus.ACKNOWLEDGED,
      });

      const result = await service.acknowledgeIncident('inc-1', 'user-1');

      expect(result.status).toBe(DeviationStatus.ACKNOWLEDGED);
      expect(incidentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ acknowledgedBy: 'user-1' }),
      );
    });

    it('throws NotFoundException when incident not found', async () => {
      incidentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.acknowledgeIncident('missing', 'user-1'),
      ).rejects.toThrow('Deviation incident missing not found');
    });

    it('returns existing incident if already acknowledged', async () => {
      const incident = {
        id: 'inc-1',
        status: DeviationStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        acknowledgedBy: 'user-1',
      };
      incidentRepo.findOne.mockResolvedValue(incident);

      const result = await service.acknowledgeIncident('inc-1', 'user-2');
      expect(incidentRepo.save).not.toHaveBeenCalled();
      expect(result.acknowledgedBy).toBe('user-1');
    });
  });

  describe('resolveIncident', () => {
    it('sets status to RESOLVED and resolvedAt', async () => {
      const incident = {
        id: 'inc-1',
        riderId: 'rider-1',
        status: DeviationStatus.OPEN,
        resolvedAt: null,
      };
      incidentRepo.findOne.mockResolvedValue(incident);
      incidentRepo.save.mockResolvedValue({
        ...incident,
        status: DeviationStatus.RESOLVED,
      });

      const result = await service.resolveIncident('inc-1');
      expect(result.status).toBe(DeviationStatus.RESOLVED);
    });

    it('throws NotFoundException when incident not found', async () => {
      incidentRepo.findOne.mockResolvedValue(null);
      await expect(service.resolveIncident('missing')).rejects.toThrow(
        'Deviation incident missing not found',
      );
    });
  });

  describe('findOpenIncidents', () => {
    it('returns open incidents ordered by createdAt DESC', async () => {
      const incidents = [{ id: 'inc-1', status: DeviationStatus.OPEN }];
      incidentRepo.find.mockResolvedValue(incidents);

      const result = await service.findOpenIncidents();
      expect(result).toEqual(incidents);
      expect(incidentRepo.find).toHaveBeenCalledWith({
        where: { status: DeviationStatus.OPEN },
        order: { createdAt: 'DESC' },
      });
    });
  });
});
