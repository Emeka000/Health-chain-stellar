import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ConfigService } from '@nestjs/config';

import { EscalationService } from '../../escalation/escalation.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { BloodRequestEntity } from '../entities/blood-request.entity';
import { BLOOD_REQUEST_QUEUE } from '../enums/request-urgency.enum';

import { BloodRequestQueueEventsListener } from './blood-request-queue-events.listener';

describe('BloodRequestQueueEventsListener', () => {
  let listener: BloodRequestQueueEventsListener;
  let notificationsService: { send: jest.Mock };
  let escalationService: { evaluate: jest.Mock };
  let queue: { getJob: jest.Mock };

  beforeEach(async () => {
    notificationsService = { send: jest.fn().mockResolvedValue(undefined) };
    escalationService = { evaluate: jest.fn().mockResolvedValue(null) };
    queue = { getJob: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        BloodRequestQueueEventsListener,
        { provide: getQueueToken(BLOOD_REQUEST_QUEUE), useValue: queue },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key, def) => def) },
        },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EscalationService, useValue: escalationService },
        {
          provide: getRepositoryToken(BloodRequestEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue({ id: 'req-1', hospitalId: 'hosp-1' }),
          },
        },
      ],
    }).compile();

    listener = module.get(BloodRequestQueueEventsListener);
  });

  it('escalates when job has exhausted all retry attempts', async () => {
    queue.getJob.mockResolvedValue({
      id: 'job-1',
      opts: { attempts: 3 },
      attemptsMade: 3,
      data: { requestId: 'req-1', urgency: 'CRITICAL', enqueuedAt: Date.now() },
    });

    await listener['handlePermanentFailure']('job-1', 'dispatch timeout');

    expect(notificationsService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'ops-team',
        templateKey: 'blood_request_job_failed',
      }),
    );
    expect(escalationService.evaluate).toHaveBeenCalled();
  });

  it('does not escalate when retries remain', async () => {
    queue.getJob.mockResolvedValue({
      id: 'job-2',
      opts: { attempts: 3 },
      attemptsMade: 1,
      data: { requestId: 'req-2', urgency: 'HIGH', enqueuedAt: Date.now() },
    });

    await listener['handlePermanentFailure']('job-2', 'transient error');

    expect(notificationsService.send).not.toHaveBeenCalled();
    expect(escalationService.evaluate).not.toHaveBeenCalled();
  });
});
