import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DonationEntity } from '../donations/entities/donation.entity';
import { DisputeEntity } from '../disputes/entities/dispute.entity';
import { SorobanService } from '../soroban/soroban.service';

import { ReconciliationRunEntity } from './entities/reconciliation-run.entity';
import { ReconciliationMismatchEntity } from './entities/reconciliation-mismatch.entity';
import { ReconciliationSnapshotEntity } from './entities/reconciliation-snapshot.entity';
import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationModule wiring', () => {
  it('resolves ReconciliationService with all injected dependencies', async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: getRepositoryToken(ReconciliationRunEntity), useValue: {} },
        { provide: getRepositoryToken(ReconciliationMismatchEntity), useValue: {} },
        { provide: getRepositoryToken(ReconciliationSnapshotEntity), useValue: {} },
        { provide: getRepositoryToken(DonationEntity), useValue: {} },
        { provide: getRepositoryToken(DisputeEntity), useValue: {} },
        { provide: SorobanService, useValue: {} },
      ],
    }).compile();

    expect(module.get(ReconciliationService)).toBeDefined();
  });

  it('lists ReconciliationService in module providers', () => {
    const { ReconciliationModule } = require('./reconciliation.module');
    const moduleProviders = Reflect.getMetadata('providers', ReconciliationModule) as unknown[];
    expect(moduleProviders).toEqual(expect.arrayContaining([ReconciliationService]));
  });
});
