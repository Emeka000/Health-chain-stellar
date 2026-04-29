import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { FeePolicyModule } from '../fee-policy.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeePolicyEntity } from '../entities/fee-policy.entity';

describe('FeePolicyController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        FeePolicyModule,
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [FeePolicyEntity],
          synchronize: true,
        }),
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('/fee-policy/analyze (POST)', () => {
    it('should return conflict analysis', () => {
      return request(app.getHttpServer())
        .post('/fee-policy/analyze')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('hasConflicts');
          expect(res.body).toHaveProperty('conflicts');
        });
    });
  });

  describe('/fee-policy/dry-run (POST)', () => {
    it('should return fee calculation preview', () => {
      const dto = {
        geographyCode: 'LAG',
        urgencyTier: 'STANDARD',
        serviceLevel: 'BASIC',
        distanceKm: 20,
        quantity: 5,
      };

      return request(app.getHttpServer())
        .post('/fee-policy/dry-run')
        .send(dto)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('policyId');
          expect(res.body).toHaveProperty('calculationSteps');
          expect(res.body).toHaveProperty('finalBreakdown');
          expect(res.body).toHaveProperty('auditHash');
        });
    });
  });

  describe('/fee-policy/canary (POST)', () => {
    it('should start canary deployment', () => {
      const dto = {
        policyId: 'policy-1',
        rolloutPercentage: 25,
      };

      return request(app.getHttpServer())
        .post('/fee-policy/canary')
        .send(dto)
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('deploymentId');
          expect(res.body).toHaveProperty('status', 'active');
        });
    });
  });

  describe('/fee-policy/canary/:id/metrics (GET)', () => {
    it('should return deployment metrics', () => {
      const deploymentId = 'deploy-1';

      return request(app.getHttpServer())
        .get(`/fee-policy/canary/${deploymentId}/metrics`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('totalRequests');
          expect(res.body).toHaveProperty('canaryRequests');
          expect(res.body).toHaveProperty('errorRate');
        });
    });
  });
});