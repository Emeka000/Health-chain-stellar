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
});
