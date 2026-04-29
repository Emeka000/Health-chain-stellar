import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { EscalationService } from './escalation.service';
import { EscalationEntity } from './entities/escalation.entity';
import { EscalationTimelineEventEntity } from './entities/escalation-timeline.entity';
import { EscalationPolicyService } from './escalation-policy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IncidentReviewEntity } from '../incident-reviews/entities/incident-review.entity';
import { RequestUrgency } from '../blood-requests/entities/blood-request.entity';
import { SecurityEventLoggerService } from '../user-activity/security-event-logger.service';

describe('EscalationService', () => {
  let service: EscalationService;

  const escalationRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((payload) => payload),
    save: jest.fn(async (payload) => ({
      id: payload.id ?? 'esc-1',
      createdAt: payload.createdAt ?? new Date(),
      ...payload,
    })),
  };
  const timelineRepo = {
    create: jest.fn((payload) => payload),
    save: jest.fn(async (payload) => payload),
    find: jest.fn(),
  };
  const incidentReviewRepo = {
    findOne: jest.fn(),
  };
  const policy = {
    evaluate: jest.fn().mockReturnValue('TIER_3'),
    slaDeadlineMs: jest.fn().mockReturnValue(Date.now() + 60_000),
    suppressionWindowMs: jest.fn().mockReturnValue(10 * 60_000),
    buildPolicyChain: jest.fn().mockReturnValue([
      {
        level: 1,
        targetRole: 'HOSPITAL_COORDINATOR',
        timeoutSeconds: 60,
        actions: ['IN_APP', 'PUSH'],
      },
      {
        level: 2,
        targetRole: 'REGIONAL_OPS_MANAGER',
        timeoutSeconds: 60,
        actions: ['SMS'],
      },
    ]),
  };
  const notificationsService = {
    send: jest.fn(),
  };
  const eventEmitter = { emit: jest.fn() };
  const securityEventLogger = { logEvent: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationService,
        { provide: getRepositoryToken(EscalationEntity), useValue: escalationRepo },
        {
          provide: getRepositoryToken(EscalationTimelineEventEntity),
          useValue: timelineRepo,
        },
        {
          provide: getRepositoryToken(IncidentReviewEntity),
          useValue: incidentReviewRepo,
        },
        { provide: EscalationPolicyService, useValue: policy },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: SecurityEventLoggerService, useValue: securityEventLogger },
      ],
    }).compile();

    service = module.get(EscalationService);
  });

  it('suppresses duplicate escalations within the suppression window', async () => {
    escalationRepo.findOne.mockResolvedValue({
      id: 'existing',
      requestId: 'req-1',
      status: 'OPEN',
      currentLevel: 1,
      createdAt: new Date(),
    });

    const result = await service.evaluate('req-1', null, 'hospital-1', null, {
      urgency: RequestUrgency.CRITICAL,
      inventoryUnits: 0,
      requiredUnits: 1,
      timeRemainingSeconds: -1,
    });

    expect(result).toBeNull();
    expect(timelineRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'SUPPRESSED_DUPLICATE' }),
    );
    expect(notificationsService.send).not.toHaveBeenCalled();
  });

  it('retries failed notifications while allowing partial channel success', async () => {
    escalationRepo.findOne.mockResolvedValue(null);
    incidentReviewRepo.findOne.mockResolvedValue(null);

    notificationsService.send
      .mockRejectedValueOnce(new Error('in_app down'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.evaluate('req-2', null, 'hospital-2', null, {
      urgency: RequestUrgency.CRITICAL,
      inventoryUnits: 0,
      requiredUnits: 1,
      timeRemainingSeconds: -1,
    });

    expect(notificationsService.send).toHaveBeenCalledTimes(3);
    expect(timelineRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'NOTIFICATION_FAILED' }),
    );
    expect(timelineRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'NOTIFICATION_SENT' }),
    );
  });

  it('escalates on timeout and stops after acknowledgement', async () => {
    escalationRepo.find.mockResolvedValueOnce([
      {
        id: 'esc-timeout',
        requestId: 'req-3',
        tier: 'TIER_3',
        hospitalId: 'hospital-3',
        currentLevel: 1,
        policyChain: [
          {
            level: 1,
            targetRole: 'HOSPITAL_COORDINATOR',
            timeoutSeconds: 60,
            actions: ['IN_APP'],
          },
          {
            level: 2,
            targetRole: 'REGIONAL_OPS_MANAGER',
            timeoutSeconds: 60,
            actions: ['SMS'],
          },
        ],
        acknowledgedAt: null,
        status: 'OPEN',
      },
    ]);
    notificationsService.send.mockResolvedValue([]);

    await service.processTimeoutEscalations();

    expect(escalationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'esc-timeout', currentLevel: 2 }),
    );
    expect(timelineRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'TIMEOUT_ESCALATED' }),
    );

    escalationRepo.findOne.mockResolvedValue({
      id: 'esc-timeout',
      requestId: 'req-3',
      currentLevel: 2,
      acknowledgedAt: null,
      status: 'OPEN',
    });
    await service.acknowledge('esc-timeout', {
      userId: 'user-1',
      role: 'hospital',
      organizationId: 'hospital-3',
    });
    expect(escalationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'esc-timeout',
        status: 'ACKNOWLEDGED',
        acknowledgedBy: 'user-1',
      }),
    );
  });

  it('denies cross-tenant escalation access and logs security event', async () => {
    escalationRepo.findOne.mockResolvedValue({
      id: 'esc-foreign',
      requestId: 'req-foreign',
      hospitalId: 'hospital-x',
      currentLevel: 1,
      acknowledgedAt: null,
      status: 'OPEN',
    });

    await expect(
      service.acknowledge('esc-foreign', {
        userId: 'user-2',
        role: 'hospital',
        organizationId: 'hospital-y',
      }),
    ).rejects.toThrow('Cross-tenant escalation access denied');
    expect(securityEventLogger.logEvent).toHaveBeenCalled();
  });
});
