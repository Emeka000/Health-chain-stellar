import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FeePolicyService } from '../../fee-policy/fee-policy.service';
import { OrderEntity } from '../entities/order.entity';
import { OrderStatus } from '../enums/order-status.enum';
import { OrderFeeService } from './order-fee.service';

const makeOrder = (overrides: Partial<OrderEntity> = {}): OrderEntity =>
  ({
    id: 'order-1',
    hospitalId: 'hosp-1',
    bloodBankId: 'bank-1',
    bloodType: 'O+',
    quantity: 3,
    status: OrderStatus.PENDING,
    feeBreakdown: null,
    appliedPolicyId: null,
    ...overrides,
  } as OrderEntity);

const feeBreakdown = { appliedPolicyId: 'policy-1', baseFee: 100, totalFee: 130 };

describe('OrderFeeService', () => {
  let service: OrderFeeService;

  const mockOrderRepo = {
    save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
  };

  const mockFeePolicy = {
    previewFees: jest.fn().mockResolvedValue(feeBreakdown),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderFeeService,
        { provide: getRepositoryToken(OrderEntity), useValue: mockOrderRepo },
        { provide: FeePolicyService, useValue: mockFeePolicy },
      ],
    }).compile();

    service = module.get(OrderFeeService);
  });

  describe('computeAndPersist', () => {
    it("builds the fee DTO from the order's own fields", async () => {
      const order = makeOrder({
        geographyCode: 'ABJ',
        urgencyTier: 'CRITICAL',
        estimatedDistanceKm: 42,
        serviceLevel: 'PREMIUM',
        partnerId: 'partner-9',
      } as Partial<OrderEntity>);
      await service.computeAndPersist(order);
      expect(mockFeePolicy.previewFees).toHaveBeenCalledWith(
        expect.objectContaining({
          geographyCode: 'ABJ',
          urgencyTier: 'CRITICAL',
          distanceKm: 42,
          serviceLevel: 'PREMIUM',
          partnerId: 'partner-9',
          quantity: 3,
        }),
      );
    });

    it('prices orders with different geography, urgency and distance differently', async () => {
      const lagosOrder = makeOrder({
        id: 'order-lag',
        geographyCode: 'LAG',
        urgencyTier: 'STANDARD',
        estimatedDistanceKm: 10,
        serviceLevel: 'BASIC',
      } as Partial<OrderEntity>);
      const abujaOrder = makeOrder({
        id: 'order-abj',
        geographyCode: 'ABJ',
        urgencyTier: 'CRITICAL',
        estimatedDistanceKm: 75,
        serviceLevel: 'PREMIUM',
      } as Partial<OrderEntity>);

      mockFeePolicy.previewFees
        .mockImplementationOnce(async (dto: any) => ({
          appliedPolicyId: `policy-${dto.geographyCode}-${dto.urgencyTier}`,
          baseFee: 100,
          totalFee: 100 + dto.distanceKm,
          inputs: dto,
        }))
        .mockImplementationOnce(async (dto: any) => ({
          appliedPolicyId: `policy-${dto.geographyCode}-${dto.urgencyTier}`,
          baseFee: 200,
          totalFee: 200 + dto.distanceKm,
          inputs: dto,
        }));

      await service.computeAndPersist(lagosOrder);
      await service.computeAndPersist(abujaOrder);

      expect(lagosOrder.appliedPolicyId).toBe('policy-LAG-STANDARD');
      expect(abujaOrder.appliedPolicyId).toBe('policy-ABJ-CRITICAL');
      expect(lagosOrder.appliedPolicyId).not.toBe(abujaOrder.appliedPolicyId);
      expect((lagosOrder.feeBreakdown as any).totalFee).not.toBe(
        (abujaOrder.feeBreakdown as any).totalFee,
      );

      const abujaTrace = (abujaOrder as any).feeCalculationTrace;
      expect(abujaTrace).toBeDefined();
      expect(abujaTrace).toEqual(
        expect.objectContaining({
          geographyCode: 'ABJ',
          urgencyTier: 'CRITICAL',
          distanceKm: 75,
          serviceLevel: 'PREMIUM',
        }),
      );
    });

    it('sets feeBreakdown and appliedPolicyId on the order', async () => {
      const order = makeOrder();
      await service.computeAndPersist(order);
      expect(order.feeBreakdown).toEqual(feeBreakdown);
      expect(order.appliedPolicyId).toBe('policy-1');
    });

    it('saves the order after computing fees', async () => {
      const order = makeOrder();
      await service.computeAndPersist(order);
      expect(mockOrderRepo.save).toHaveBeenCalledWith(order);
    });

    it('passes order quantity to the fee preview', async () => {
      const order = makeOrder({ quantity: 7 });
      await service.computeAndPersist(order);
      expect(mockFeePolicy.previewFees).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 7 }),
      );
    });
  });

  describe('preview', () => {
    it('returns fee preview without saving', async () => {
      const order = makeOrder();
      const result = await service.preview(order);
      expect(result).toEqual(feeBreakdown);
      expect(mockOrderRepo.save).not.toHaveBeenCalled();
    });

    it("uses the order's own fields as the base DTO", async () => {
      const order = makeOrder({
        geographyCode: 'KAN',
        urgencyTier: 'URGENT',
        estimatedDistanceKm: 25,
        serviceLevel: 'STANDARD',
      } as Partial<OrderEntity>);
      await service.preview(order);
      expect(mockFeePolicy.previewFees).toHaveBeenCalledWith(
        expect.objectContaining({
          geographyCode: 'KAN',
          urgencyTier: 'URGENT',
          distanceKm: 25,
          serviceLevel: 'STANDARD',
        }),
      );
    });

    it('merges overrides into the order-derived DTO', async () => {
      const order = makeOrder({
        geographyCode: 'KAN',
        urgencyTier: 'URGENT',
        estimatedDistanceKm: 25,
      } as Partial<OrderEntity>);
      await service.preview(order, { distanceKm: 50, geographyCode: 'ABJ' });
      expect(mockFeePolicy.previewFees).toHaveBeenCalledWith(
        expect.objectContaining({
          distanceKm: 50,
          geographyCode: 'ABJ',
          urgencyTier: 'URGENT',
        }),
      );
    });

    it('overrides do not mutate the default quantity', async () => {
      const order = makeOrder({ quantity: 5 });
      await service.preview(order, { distanceKm: 10 });
      expect(mockFeePolicy.previewFees).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 5 }),
      );
    });
  });
});
