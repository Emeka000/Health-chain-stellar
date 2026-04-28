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
    it('calls previewFees with default LAG geography and STANDARD urgency', async () => {
      const order = makeOrder();
      await service.computeAndPersist(order);
      expect(mockFeePolicy.previewFees).toHaveBeenCalledWith(
        expect.objectContaining({ geographyCode: 'LAG', urgencyTier: 'STANDARD' }),
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

    it('merges overrides into the default DTO', async () => {
      const order = makeOrder();
      await service.preview(order, { distanceKm: 50, geographyCode: 'ABJ' });
      expect(mockFeePolicy.previewFees).toHaveBeenCalledWith(
        expect.objectContaining({ distanceKm: 50, geographyCode: 'ABJ' }),
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
