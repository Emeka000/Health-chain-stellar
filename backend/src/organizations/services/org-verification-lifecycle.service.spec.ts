import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { SorobanService } from '../../soroban/soroban.service';
import { OrderEntity } from '../../orders/entities/order.entity';
import { OrgVerificationLifecycleService } from './org-verification-lifecycle.service';
import { OrganizationRepository } from '../organizations.repository';
import { OrgVerificationHistoryEntity } from '../entities/org-verification-history.entity';
import { OrgGracePeriodEntity } from '../entities/org-grace-period.entity';
import { OrganizationVerificationStatus } from '../enums/organization-verification-status.enum';

describe('OrgVerificationLifecycleService', () => {
  let service: OrgVerificationLifecycleService;
  let orgRepo: { findOne: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    orgRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (entity) => entity),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgVerificationLifecycleService,
        { provide: OrganizationRepository, useValue: orgRepo },
        {
          provide: getRepositoryToken(OrgVerificationHistoryEntity),
          useValue: {
            create: jest.fn((entity) => entity),
            save: jest.fn(async (entity) => entity),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(OrgGracePeriodEntity),
          useValue: {
            create: jest.fn((entity) => entity),
            save: jest.fn(async (entity) => entity),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(OrderEntity),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        { provide: SorobanService, useValue: { verifyOrganization: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(OrgVerificationLifecycleService);
  });

  it('rejects a reapply when the caller is neither admin nor a member of the organization', async () => {
    orgRepo.findOne.mockResolvedValue({
      id: 'org-1',
      status: OrganizationVerificationStatus.REJECTED,
    });

    await expect(
      service.reapply('org-1', { id: 'user-2', role: 'donor', organizationId: 'org-2' }, { note: 'Retry' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
