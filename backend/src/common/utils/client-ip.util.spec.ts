import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import request from 'supertest';

import { getClientIp } from './client-ip.util';

@Controller('client-ip-test')
class ClientIpProbeController {
  @Get()
  getIp(@Req() req: { ip?: string; socket: { remoteAddress?: string } }) {
    return {
      ipAddress: getClientIp(req),
      socketAddress: req.socket.remoteAddress,
    };
  }
}

describe('getClientIp', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ClientIpProbeController],
    }).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', false);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('uses the socket address instead of a spoofed X-Forwarded-For header', async () => {
    await request(app.getHttpServer())
      .get('/client-ip-test')
      .set('X-Forwarded-For', '203.0.113.99')
      .expect(200)
      .expect(({ body }) => {
        expect(body.ipAddress).toBe(body.socketAddress);
        expect(body.ipAddress).not.toBe('203.0.113.99');
      });
  });
});