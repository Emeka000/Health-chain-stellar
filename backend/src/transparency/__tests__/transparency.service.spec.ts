import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BloodUnitEntity } from '../../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../../orders/entities/order.entity';
import { OrderStatus } from '../../orders/enums/order-status.enum';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { OrganizationVerificationStatus } from '../../organizations/enums/organization-verification-status.enum';
import { TransparencyService } from '../transparency.service';

const makeOrderRepo = (overrides: Partial<Record<string, unknown>> = {}) => ({
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ avgHours: null }),
    getRawMany: jest.fn().mockResolvedValue([]),
  }),
  ...overrides,
});

const makeOrgRepo = (overrides: Partial<Record<string, unknown>> = {}) => ({
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getRawMany: jest.fn().mockResolvedValue([]),
  }),
  ...overrides,
});

const makeBloodUnitRepo = () => ({
  count: jest.fn().mockResolvedValue(0),
});

async function buildService(
  orderRepo: ReturnType<typeof makeOrderRepo>,
  orgRepo: ReturnType<typeof makeOrgRepo>,
  bloodUnitRepo: ReturnType<typeof makeBloodUnitRepo>,
) {
  const module = await Test.createTestingModule({
    providers: [
      TransparencyService,
      { provide: getRepositoryToken(OrderEntity), useValue: orderRepo },
      { provide: getRepositoryToken(OrganizationEntity), useValue: orgRepo },
      { provide: getRepositoryToken(BloodUnitEntity), useValue: bloodUnitRepo },
    ],
  }).compile();

  return module.get(TransparencyService);
}

describe('TransparencyService – public metrics transformations', () => {
  it('returns zeroed metrics snapshot when database is empty', async () => {
    const service = await buildService(
      makeOrderRepo(),
      makeOrgRepo(),
      makeBloodUnitRepo(),
    );

    const result = await service.getPublicMetrics();

    expect({ ...result, generatedAt: '<timestamp>' }).toMatchSnapshot();
  });

  it('aggregates fulfilled requests and blood type breakdown correctly', async () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ avgHours: '2.5' }),
      getRawMany: jest
        .fn()
        .mockResolvedValueOnce([
          { bloodType: 'A+', count: '10' },
          { bloodType: 'O-', count: '5' },
        ])
        .mockResolvedValue([]),
    };

    const orderRepo = makeOrderRepo({
      count: jest.fn().mockResolvedValue(42),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    });

    const orgQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(3),
      getRawMany: jest.fn().mockResolvedValue([
        { region: 'Lagos', count: '4' },
      ]),
    };

    const orgRepo = makeOrgRepo({
      count: jest.fn().mockResolvedValue(7),
      createQueryBuilder: jest.fn().mockReturnValue(orgQb),
    });

    const bloodUnitRepo = { count: jest.fn().mockResolvedValue(120) };

    const service = await buildService(orderRepo, orgRepo, bloodUnitRepo);
    const result = await service.getPublicMetrics();

    expect(result.fulfilledRequests).toBe(42);
    expect(result.avgResponseTimeHours).toBe(2.5);
    expect(result.totalDonationsRecorded).toBe(120);
    expect(result.verifiedPartners).toBe(7);
    expect(result.onChainVerifiedOrgs).toBe(3);
    expect(result.bloodTypeBreakdown).toEqual({ 'A+': 10, 'O-': 5 });
    expect(result.geographicCoverage[0].region).toBe('Lagos');
    expect({ ...result, generatedAt: '<timestamp>' }).toMatchSnapshot();
  });

  it('returns null avgResponseTimeHours when no delivered orders exist', async () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ avgHours: null }),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    const service = await buildService(
      makeOrderRepo({ createQueryBuilder: jest.fn().mockReturnValue(qb) }),
      makeOrgRepo(),
      makeBloodUnitRepo(),
    );

    const result = await service.getPublicMetrics();
    expect(result.avgResponseTimeHours).toBeNull();
  });

  it('strips sensitive fields — no donor IDs, patient data, or internal IDs', async () => {
    const service = await buildService(
      makeOrderRepo(),
      makeOrgRepo(),
      makeBloodUnitRepo(),
    );

    const result = await service.getPublicMetrics();
    const json = JSON.stringify(result);

    expect(json).not.toMatch(/donorId/);
    expect(json).not.toMatch(/hospitalId/);
    expect(json).not.toMatch(/riderId/);
    expect(json).not.toMatch(/patientId/);
    expect(json).not.toMatch(/email/);
    expect(json).not.toMatch(/phone/);
  });
});
