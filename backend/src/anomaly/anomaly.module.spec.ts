import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { PolicyCenterService } from '../policy-center/policy-center.service';

import { AnomalyScoringService } from './anomaly-scoring.service';
import { AnomalyService } from './anomaly.service';
import { AnomalyDriftService } from './anomaly-drift.service';
import { AnomalyIncidentEntity } from './entities/anomaly-incident.entity';

describe('AnomalyModule wiring', () => {
  it('resolves AnomalyScoringService with all injected dependencies', async () => {
    const module = await Test.createTestingModule({
      providers: [
        AnomalyScoringService,
        { provide: getRepositoryToken(AnomalyIncidentEntity), useValue: {} },
        { provide: getRepositoryToken(BloodRequestEntity), useValue: {} },
        { provide: getRepositoryToken(OrderEntity), useValue: {} },
        {
          provide: PolicyCenterService,
          useValue: { getActivePolicySnapshot: jest.fn() },
        },
      ],
    }).compile();

    expect(module.get(AnomalyScoringService)).toBeDefined();
  });

  it('lists AnomalyScoringService in module providers', () => {
    const { AnomalyModule } = require('./anomaly.module');
    const moduleProviders = Reflect.getMetadata('providers', AnomalyModule) as unknown[];
    expect(moduleProviders).toEqual(
      expect.arrayContaining([AnomalyService, AnomalyScoringService, AnomalyDriftService]),
    );
  });
});
