import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ForbiddenException } from '@nestjs/common';
import * as request from 'supertest';
import { BlockchainController } from '../src/blockchain/controllers/blockchain.controller';
import { AdminGuard } from '../src/auth/guards/admin.guard';
import { BlockchainService } from '../src/blockchain/services/blockchain.service';
import { SorobanService } from '../src/blockchain/services/soroban.service';
import { QueueService } from '../src/blockchain/services/queue.service';
import { DlqAuditService } from '../src/blockchain/services/dlq-audit.service';
import { MetricsService } from '../src/blockchain/services/metrics.service';
import { RetryService } from '../src/blockchain/services/retry.service';

describe('BlockchainController (e2e)', () => {
  let app: INestApplication;

  const queueService = {
    getStatus: jest.fn(),
    getJobStatus: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [BlockchainController],
      providers: [
        { provide: BlockchainService, useValue: {} },
        { provide: SorobanService, useValue: {} },
        { provide: QueueService, useValue: queueService },
        { provide: DlqAuditService, useValue: { list: jest.fn() } },
        { provide: MetricsService, useValue: { getMetrics: jest.fn() } },
        { provide: RetryService, useValue: { retry: jest.fn() } },
        {
          provide: AdminGuard,
          useValue: {
            canActivate: (context: any) => {
              const req = context.switchToHttp().getRequest();
              if (!req.user?.isAdmin) {
                throw new ForbiddenException();
              }
              return true;
            },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /blockchain/job/:jobId', () => {
    it('returns 403 for a non-admin requesting another user\'s job', async () => {
      queueService.getJobStatus.mockResolvedValue({
        jobId: 'job-123',
        status: 'completed',
        submittedBy: 'user-owner',
      });

      await request(app.getHttpServer())
        .get('/blockchain/job/job-123')
        .set('x-test-user', 'user-attacker')
        .expect(403);

      expect(queueService.getJobStatus).not.toHaveBeenCalled();
    });

    it('returns 200 for an admin', async () => {
      queueService.getJobStatus.mockResolvedValue({
        jobId: 'job-123',
        status: 'completed',
      });

      await request(app.getHttpServer())
        .get('/blockchain/job/job-123')
        .set('x-test-user', 'admin-user')
        .set('x-test-admin', 'true')
        .expect(200);
    });
  });
});
