import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import request from 'supertest';

import { BloodMatchingController } from '../blood-matching/controllers/blood-matching.controller';
import { BloodMatchingService } from '../blood-matching/services/blood-matching.service';
import { BloodCompatibilityEngine } from '../blood-matching/compatibility/blood-compatibility.engine';
import { ApiCompatibilityInterceptor } from '../common/versioning/api-compatibility.interceptor';

describe('[CONTRACT] API Compatibility + Deprecation Headers', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BloodMatchingController],
      providers: [
        {
          provide: BloodMatchingService,
          useValue: {
            findMatches: jest.fn(),
            findMatchesForMultipleRequests: jest.fn(),
            getCompatibilityMatrix: jest.fn(),
            getCompatibleBloodTypes: jest.fn().mockReturnValue(['O-', 'A-']),
            getDonatableBloodTypes: jest.fn().mockReturnValue(['A+', 'AB+']),
            calculateMatchingScore: jest.fn(),
          },
        },
        {
          provide: BloodCompatibilityEngine,
          useValue: {
            preview: jest.fn().mockReturnValue({
              compatible: true,
              matchType: 'compatible',
              explanation: 'compatible',
              emergencySubstitution: false,
            }),
            compatibleDonors: jest.fn().mockReturnValue([
              {
                donorType: 'O-',
                matchType: 'compatible',
                explanation: 'safe',
              },
              {
                donorType: 'A-',
                matchType: 'exact',
                explanation: 'exact',
              },
            ]),
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalInterceptors(
      new ApiCompatibilityInterceptor(app.get(Reflector)),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns canonical shape and compatibility headers', async () => {
    const res = await request(app.getHttpServer())
      .get('/blood-matching/compatible-donors')
      .query({
        recipientType: 'A+',
        component: 'RED_CELLS',
      })
      .expect(200);

    expect(res.headers['x-api-compatibility-class']).toBe('additive');
    expect(res.headers['x-api-response-shape']).toBe('canonical');
    expect(res.headers['deprecation']).toBe('true');
    expect(Array.isArray(res.body.donors)).toBe(true);
    expect(res.body.donors[0]).toEqual(
      expect.objectContaining({ donorType: 'O-' }),
    );
  });

  it('returns legacy adapter payload for legacy clients', async () => {
    const res = await request(app.getHttpServer())
      .get('/blood-matching/compatible-donors')
      .set('X-API-Client-Shape', 'legacy')
      .query({
        recipientType: 'A+',
        component: 'RED_CELLS',
      })
      .expect(200);

    expect(res.headers['x-api-response-shape']).toBe('legacy');
    expect(res.headers['deprecation']).toBe('true');
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual(['O-', 'A-']);
  });

  it('sets endpoint-level deprecation metadata headers', async () => {
    const res = await request(app.getHttpServer())
      .get('/blood-matching/compatible-types')
      .query({ bloodType: 'A+' })
      .expect(200);

    expect(res.headers['x-api-compatibility-class']).toBe('deprecated');
    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBeDefined();
    expect(res.headers['link']).toContain('successor-version');
  });
});
