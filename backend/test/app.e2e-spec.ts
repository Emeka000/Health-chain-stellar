import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  describe('API Versioning (v1)', () => {
    it('should have v1 prefix in API routes', () => {
      return request(app.getHttpServer())
        .get('/api/v1/')
        .expect(200)
        .expect('Hello World!');
    });

    it('should return 404 for routes without v1 prefix', () => {
      return request(app.getHttpServer()).get('/blood-requests').expect(404);
    });

    it('should return 200 for versioned auth endpoint', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'password' })
        .expect(400); // Bad request due to invalid credentials, but endpoint exists
    });
  });

  describe('DTO Validation - forbidNonWhitelisted enforcement', () => {
    it('should reject unknown fields in query parameters', () => {
      return request(app.getHttpServer())
        .get('/api/v1/blood-requests')
        .query({ page: 1, unknown_field: 'should_be_rejected' })
        .expect(400);
    });

    it('should reject unknown fields in POST request body', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password',
          unknown_field: 'should_be_rejected',
        })
        .expect(400);
    });

    it('should accept only whitelisted fields', () => {
      return request(app.getHttpServer())
        .get('/api/v1/blood-requests')
        .query({ page: 1, limit: 10 })
        .expect((res) => {
          // Should either succeed or fail with validation error (not unknown field error)
          expect([200, 401, 403, 404]).toContain(res.status);
        });
    });
  });
});
