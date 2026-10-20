import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';

import request from 'supertest';

import { PermissionsService } from '../auth/permissions.service';
import { Permission } from '../auth/enums/permission.enum';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CanonicalEventEmitterService } from './canonical-event-emitter.service';
import { DeadLetterController } from './dead-letter.controller';
import { DeadLetterService } from './dead-letter.service';
import { OutboxController } from './outbox.controller';
import { OutboxService } from './outbox.service';

describe('Event queue admin authorization', () => {
  let app: INestApplication;
  const deadLetterService = {
    queryDeadLetters: jest.fn().mockResolvedValue([]),
    getStatistics: jest.fn().mockResolvedValue({}),
    replayDeadLetters: jest.fn().mockResolvedValue({}),
    purgeOldEvents: jest.fn().mockResolvedValue(0),
  };
  const outboxService = {
    getDeadLetters: jest.fn().mockResolvedValue([]),
    replayDeadLetter: jest.fn().mockResolvedValue({}),
    discardDeadLetter: jest.fn().mockResolvedValue({}),
  };
  const permissionsService = {
    getPermissionsForRole: jest.fn((role: string) =>
      Promise.resolve(role === 'admin' ? [Permission.ADMIN_ACCESS] : []),
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DeadLetterController, OutboxController],
      providers: [
        { provide: DeadLetterService, useValue: deadLetterService },
        { provide: CanonicalEventEmitterService, useValue: { emit: jest.fn() } },
        { provide: OutboxService, useValue: outboxService },
        { provide: PermissionsService, useValue: permissionsService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { id: 'test-user', role: req.header('x-test-role') ?? 'donor' };
      next();
    });
    app.useGlobalGuards(
      new PermissionsGuard(app.get(Reflector), app.get(PermissionsService)),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    deadLetterService.queryDeadLetters.mockResolvedValue([]);
    deadLetterService.getStatistics.mockResolvedValue({});
    deadLetterService.replayDeadLetters.mockResolvedValue({});
    deadLetterService.purgeOldEvents.mockResolvedValue(0);
    outboxService.getDeadLetters.mockResolvedValue([]);
    outboxService.replayDeadLetter.mockResolvedValue({});
    outboxService.discardDeadLetter.mockResolvedValue({});
  });

  it('returns 403 to non-admins on all eight event queue routes', async () => {
    const responses = await Promise.all([
      request(app.getHttpServer()).get('/dead-letter'),
      request(app.getHttpServer()).get('/dead-letter/statistics'),
      request(app.getHttpServer()).get('/dead-letter/event-1'),
      request(app.getHttpServer()).post('/dead-letter/replay').send({}),
      request(app.getHttpServer()).delete('/dead-letter/purge?olderThanDays=7'),
      request(app.getHttpServer()).get('/outbox/dead-letters'),
      request(app.getHttpServer())
        .post('/outbox/dead-letters/event-1/replay')
        .send({}),
      request(app.getHttpServer())
        .post('/outbox/dead-letters/event-1/discard')
        .send({}),
    ].map((test) => test.set('x-test-role', 'donor').expect(403)));

    expect(responses).toHaveLength(8);
    expect(deadLetterService.replayDeadLetters).not.toHaveBeenCalled();
    expect(deadLetterService.purgeOldEvents).not.toHaveBeenCalled();
    expect(outboxService.replayDeadLetter).not.toHaveBeenCalled();
    expect(outboxService.discardDeadLetter).not.toHaveBeenCalled();
  });

  it('allows an admin to purge at least seven days of history', async () => {
    await request(app.getHttpServer())
      .delete('/dead-letter/purge?olderThanDays=7')
      .set('x-test-role', 'admin')
      .expect(200);

    expect(deadLetterService.purgeOldEvents).toHaveBeenCalledWith(7);
  });

  it('rejects purge ages below seven days and non-integer values', async () => {
    await request(app.getHttpServer())
      .delete('/dead-letter/purge?olderThanDays=6')
      .set('x-test-role', 'admin')
      .expect(400);

    await request(app.getHttpServer())
      .delete('/dead-letter/purge?olderThanDays=invalid')
      .set('x-test-role', 'admin')
      .expect(400);

    expect(deadLetterService.purgeOldEvents).not.toHaveBeenCalled();
  });
});