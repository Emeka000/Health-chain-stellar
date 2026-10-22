import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import request from 'supertest';

import { createCorsOptions } from '../src/config/cors-options';

describe('CORS (e2e)', () => {
  let app: INestApplication;
  const allowedOrigin = 'http://localhost:3000';

  beforeAll(async () => {
    const module = await Test.createTestingModule({}).compile();
    app = module.createNestApplication();
    app.enableCors(createCorsOptions(allowedOrigin));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows a preflight requesting the Idempotency-Key header', async () => {
    const response = await request(app.getHttpServer())
      .options('/')
      .set('Origin', allowedOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'idempotency-key')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-headers']).toContain(
      'Idempotency-Key',
    );
  });
});