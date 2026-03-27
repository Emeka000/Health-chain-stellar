import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  FEE_POLICY_ERRORS,
  PAYMENT_AMOUNT_MIN_STROOPS,
} from './fee-policy.constants';
import { QuotePaymentDto } from './fee-policy.dto';
import {
  FeePolicyEntity,
  FeeRecipientType,
  FeePolicyStatus,
} from './fee-policy.entity';
import { FeePolicyService } from './fee-policy.service';

// ─── Factory helpers ──────────────────────────────────────────────────────────

const makePolicy = (
  overrides: Partial<FeePolicyEntity> = {},
): FeePolicyEntity =>
  Object.assign(new FeePolicyEntity(), {
    id: 'policy-uuid-1',
    name: 'Standard Provider Payout',
    recipientType: FeeRecipientType.PROVIDER,
    platformFeeBp: 100,
    insuranceFeeBp: 50,
    flatFeeStroops: 500_000,
    stellarNetworkFeeStroops: 100,
    status: FeePolicyStatus.ACTIVE,
    description: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  });

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('FeePolicyService', () => {
  let service: FeePolicyService;
  let repo: jest.Mocked<Repository<FeePolicyEntity>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeePolicyService,
        {
          provide: getRepositoryToken(FeePolicyEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOneBy: jest.fn(),
            merge: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(FeePolicyService);
    repo = module.get(getRepositoryToken(FeePolicyEntity));
  });

  afterEach(() => jest.clearAllMocks());

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('saves and returns a new policy', async () => {
      const policy = makePolicy({ status: FeePolicyStatus.DRAFT });
      repo.create.mockReturnValue(policy);
      repo.save.mockResolvedValue(policy);

      const result = await service.create({
        name: policy.name,
        recipientType: policy.recipientType,
        platformFeeBp: policy.platformFeeBp,
        insuranceFeeBp: policy.insuranceFeeBp,
        flatFeeStroops: policy.flatFeeStroops,
        stellarNetworkFeeStroops: policy.stellarNetworkFeeStroops,
      });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result.name).toBe(policy.name);
    });

    it('throws BadRequestException for an invalid policy structure', async () => {
      const policy = makePolicy({ platformFeeBp: 9999 }); // over max
      repo.create.mockReturnValue(policy);

      await expect(
        service.create({
          name: policy.name,
          recipientType: policy.recipientType,
          platformFeeBp: 9999,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all policies as DTOs', async () => {
      const policies = [makePolicy(), makePolicy({ id: 'policy-uuid-2' })];
      repo.find.mockResolvedValue(policies);

      const result = await service.findAll();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(policies[0].id);
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the policy when found', async () => {
      const policy = makePolicy();
      repo.findOneBy.mockResolvedValue(policy);

      const result = await service.findOne(policy.id);
      expect(result.id).toBe(policy.id);
    });

    it('throws NotFoundException when policy does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('merges, validates, and saves the updated policy', async () => {
      const policy = makePolicy();
      repo.findOneBy.mockResolvedValue(policy);
      repo.merge.mockReturnValue({ ...policy, platformFeeBp: 200 });
      repo.save.mockResolvedValue({ ...policy, platformFeeBp: 200 });

      const result = await service.update(policy.id, { platformFeeBp: 200 });
      expect(result.platformFeeBp).toBe(200);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException if updated config is invalid', async () => {
      const policy = makePolicy();
      repo.findOneBy.mockResolvedValue(policy);
      repo.merge.mockReturnValue({ ...policy, platformFeeBp: 9999 });

      await expect(
        service.update(policy.id, { platformFeeBp: 9999 }),
      ).rejects.toThrow(BadRequestException);

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  // ─── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes the entity', async () => {
      const policy = makePolicy();
      repo.findOneBy.mockResolvedValue(policy);
      repo.remove.mockResolvedValue(policy);

      await service.remove(policy.id);
      expect(repo.remove).toHaveBeenCalledWith(policy);
    });
  });

  // ─── activate / deactivate ─────────────────────────────────────────────────

  describe('activate', () => {
    it('sets status to ACTIVE', async () => {
      const policy = makePolicy({ status: FeePolicyStatus.DRAFT });
      repo.findOneBy.mockResolvedValue(policy);
      repo.merge.mockReturnValue({ ...policy, status: FeePolicyStatus.ACTIVE });
      repo.save.mockResolvedValue({
        ...policy,
        status: FeePolicyStatus.ACTIVE,
      });

      const result = await service.activate(policy.id);
      expect(result.status).toBe(FeePolicyStatus.ACTIVE);
    });
  });

  describe('deactivate', () => {
    it('sets status to INACTIVE', async () => {
      const policy = makePolicy({ status: FeePolicyStatus.ACTIVE });
      repo.findOneBy.mockResolvedValue(policy);
      repo.merge.mockReturnValue({
        ...policy,
        status: FeePolicyStatus.INACTIVE,
      });
      repo.save.mockResolvedValue({
        ...policy,
        status: FeePolicyStatus.INACTIVE,
      });

      const result = await service.deactivate(policy.id);
      expect(result.status).toBe(FeePolicyStatus.INACTIVE);
    });
  });

  // ─── quotePayment ──────────────────────────────────────────────────────────

  describe('quotePayment', () => {
    const quoteDto: QuotePaymentDto = {
      grossAmountStroops: 500_000_000,
      feePolicyId: 'policy-uuid-1',
    };

    it('returns a valid fee breakdown for a healthy quote', async () => {
      const policy = makePolicy();
      repo.findOneBy.mockResolvedValue(policy);

      const breakdown = await service.quotePayment(quoteDto);

      expect(breakdown.grossAmountStroops).toBe(quoteDto.grossAmountStroops);
      expect(breakdown.netAmountStroops).toBeLessThan(
        quoteDto.grossAmountStroops,
      );
      expect(breakdown.totalFeeStroops).toBeGreaterThan(0);
      expect(breakdown.effectiveFeePercent).toMatch(/%$/);
    });

    it('throws BadRequestException if policy is not active', async () => {
      const policy = makePolicy({ status: FeePolicyStatus.DRAFT });
      repo.findOneBy.mockResolvedValue(policy);

      await expect(service.quotePayment(quoteDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if policy does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.quotePayment(quoteDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws UnprocessableEntityException for an amount below minimum', async () => {
      const policy = makePolicy();
      repo.findOneBy.mockResolvedValue(policy);

      await expect(
        service.quotePayment({
          ...quoteDto,
          grossAmountStroops: PAYMENT_AMOUNT_MIN_STROOPS - 1,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('includes specific validation errors in the 422 response', async () => {
      const policy = makePolicy();
      repo.findOneBy.mockResolvedValue(policy);

      let thrownError: UnprocessableEntityException | null = null;
      try {
        await service.quotePayment({
          ...quoteDto,
          grossAmountStroops: PAYMENT_AMOUNT_MIN_STROOPS - 1,
        });
      } catch (err) {
        thrownError = err as UnprocessableEntityException;
      }

      expect(thrownError).not.toBeNull();
      const body = thrownError!.getResponse() as { errors: string[] };
      expect(body.errors).toContain(FEE_POLICY_ERRORS.AMOUNT_BELOW_MIN);
    });

    it('net amount in breakdown equals gross minus total fees', async () => {
      const policy = makePolicy();
      repo.findOneBy.mockResolvedValue(policy);

      const breakdown = await service.quotePayment(quoteDto);
      expect(breakdown.netAmountStroops).toBe(
        breakdown.grossAmountStroops - breakdown.totalFeeStroops,
      );
    });
  });
});
