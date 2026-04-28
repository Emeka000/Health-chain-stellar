import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import request from 'supertest';

import { RoleAwareThrottlerGuard } from './role-aware-throttler.guard';

@Controller('load-test')
class LoadTestController {
  @Get('public')
  publicEndpoint() {
    return { ok: true, role: 'PUBLIC' };
  }

  @Get('hospital')
  hospitalEndpoint() {
    return { ok: true, role: 'HOSPITAL' };
  }

  @Get('emergency')
  emergencyEndpoint() {
    return { ok: true, role: 'EMERGENCY' };
  }
}

/**
 * Load test simulating mixed traffic: bursty abuse from PUBLIC users
 * mixed with legitimate HOSPITAL requests and emergency workflows.
 */
describe('RoleAwareThrottlerGuard — Load Test Simulation', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 1000 }],
        }),
      ],
      controllers: [LoadTestController],
      providers: [{ provide: APP_GUARD, useClass: RoleAwareThrottlerGuard }],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Middleware to simulate user injection
    app.use((req: any, res: any, next: () => void) => {
      const role = req.headers['x-test-role'] || 'PUBLIC';
      const orgId = req.headers['x-test-org'] || 'default';
      req.user = { id: `test-${role}-${Date.now()}`, role, orgId };
      next();
    });

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should protect emergency workflows from starvation during abuse spikes', async () => {
    const totalRequests = 100;
    const publicRequests = Math.floor(totalRequests * 0.7); // 70% abusive public
    const hospitalRequests = Math.floor(totalRequests * 0.2); // 20% hospital
    const emergencyRequests = Math.floor(totalRequests * 0.1); // 10% emergency

    let publicBlocked = 0;
    let hospitalBlocked = 0;
    let emergencyBlocked = 0;

    // Simulate bursty traffic
    const promises = [];

    // Public abusive requests
    for (let i = 0; i < publicRequests; i++) {
      promises.push(
        request(app.getHttpServer())
          .get('/load-test/public')
          .set('x-test-role', 'PUBLIC')
          .then(res => {
            if (res.status === 429) publicBlocked++;
          })
      );
    }

    // Hospital legitimate requests
    for (let i = 0; i < hospitalRequests; i++) {
      promises.push(
        request(app.getHttpServer())
          .get('/load-test/hospital')
          .set('x-test-role', 'HOSPITAL')
          .then(res => {
            if (res.status === 429) hospitalBlocked++;
          })
      );
    }

    // Emergency critical requests
    for (let i = 0; i < emergencyRequests; i++) {
      promises.push(
        request(app.getHttpServer())
          .get('/load-test/emergency')
          .set('x-test-role', 'HOSPITAL') // Emergency uses hospital role
          .then(res => {
            if (res.status === 429) emergencyBlocked++;
          })
      );
    }

    await Promise.all(promises);

    // Emergency workflows should have minimal blocking
    expect(emergencyBlocked).toBeLessThan(emergencyRequests * 0.1); // <10% emergency blocked

    // Hospital should be protected better than public
    expect(hospitalBlocked).toBeLessThan(publicBlocked);

    console.log(`Load test results: Public blocked: ${publicBlocked}/${publicRequests}, Hospital blocked: ${hospitalBlocked}/${hospitalRequests}, Emergency blocked: ${emergencyBlocked}/${emergencyRequests}`);
  }, 30000); // 30 second timeout for load test
});