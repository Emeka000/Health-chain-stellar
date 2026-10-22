import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnboardingReconciliationService } from './onboarding-reconciliation.service';
import {
  PartnerOnboardingEntity,
  OnboardingStatus,
} from '../entities/partner-onboarding.entity';

describe('OnboardingReconciliationService', () => {
  let service: OnboardingReconciliationService;
  let repository: jest.Mocked<Repository<PartnerOnboardingEntity>>;

  const buildOnboarding = (
    overrides: Partial<PartnerOnboardingEntity> = {},
  ): PartnerOnboardingEntity =>
    ({
      id: 'onboarding-1',
      partnerId: 'partner-1',
      status: OnboardingStatus.APPROVED,
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      ...overrides,
    } as PartnerOnboardingEntity);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingReconciliationService,
        {
          provide: getRepositoryToken(PartnerOnboardingEntity),
          useValue: {
            find: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<OnboardingReconciliationService>(
      OnboardingReconciliationService,
    );
    repository = module.get(getRepositoryToken(PartnerOnboardingEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('drives a stuck APPROVED onboarding through to ACTIVATED', async () => {
    const stuck = buildOnboarding();
    repository.find.mockResolvedValue([stuck]);
    repository.save.mockImplementation(async (entity) => entity as any);

    await service.reconcileStuckOnboardings();

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: OnboardingStatus.APPROVED }),
      }),
    );
    expect(repository.save).toHaveBeenCalledTimes(1);
    const saved = repository.save.mock.calls[0][0] as PartnerOnboardingEntity;
    expect(saved.status).toBe(OnboardingStatus.ACTIVATED);
  });

  it('leaves onboardings that are not stuck untouched', async () => {
    repository.find.mockResolvedValue([]);

    await service.reconcileStuckOnboardings();

    expect(repository.save).not.toHaveBeenCalled();
  });
});
