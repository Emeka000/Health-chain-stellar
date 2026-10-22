import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { CreatePledgeDto, UpdatePledgeStatusDto } from '../dto';
import { DonationAsset } from '../enums/donation.enum';
import { PledgeFrequency, PledgeStatus } from '../enums/pledge.enum';

describe('Pledge DTOs — validation', () => {
  describe('CreatePledgeDto', () => {
    it('accepts a valid pledge payload', async () => {
      const dto = plainToClass(CreatePledgeDto, {
        amount: 50.0,
        payerAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4PSZNRISKIEMXG45VQUVFODRJTCHKSC',
        recipientId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        frequency: PledgeFrequency.MONTHLY,
        asset: DonationAsset.XLM,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts minimal required fields', async () => {
      const dto = plainToClass(CreatePledgeDto, {
        amount: 50.0,
        payerAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4PSZNRISKIEMXG45VQUVFODRJTCHKSC',
        recipientId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        frequency: PledgeFrequency.WEEKLY,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects missing required fields', async () => {
      const dto = plainToClass(CreatePledgeDto, {
        amount: 50.0,
        payerAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4PSZNRISKIEMXG45VQUVFODRJTCHKSC',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const fieldNames = errors.map((e) => e.property);
      expect(fieldNames).toContain('recipientId');
      expect(fieldNames).toContain('frequency');
    });

    it('rejects non-positive amounts', async () => {
      const dto = plainToClass(CreatePledgeDto, {
        amount: 0,
        payerAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4PSZNRISKIEMXG45VQUVFODRJTCHKSC',
        recipientId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        frequency: PledgeFrequency.MONTHLY,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('isPositive');
    });

    it('rejects invalid frequency enum', async () => {
      const dto = plainToClass(CreatePledgeDto, {
        amount: 50.0,
        payerAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4PSZNRISKIEMXG45VQUVFODRJTCHKSC',
        recipientId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        frequency: 'DAILY' as any,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const freqError = errors.find((e) => e.property === 'frequency');
      expect(freqError?.constraints).toHaveProperty('isEnum');
    });

    it('validates all PledgeFrequency enum values', async () => {
      const frequencies = [
        PledgeFrequency.WEEKLY,
        PledgeFrequency.MONTHLY,
        PledgeFrequency.QUARTERLY,
      ];
      for (const frequency of frequencies) {
        const dto = plainToClass(CreatePledgeDto, {
          amount: 50.0,
          payerAddress:
            'GBRPYHIL2CI3WHZDTOOQFC6EB4PSZNRISKIEMXG45VQUVFODRJTCHKSC',
          recipientId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          frequency,
        });
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      }
    });

    it('accepts optional fields', async () => {
      const dto = plainToClass(CreatePledgeDto, {
        amount: 50.0,
        payerAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4PSZNRISKIEMXG45VQUVFODRJTCHKSC',
        recipientId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        frequency: PledgeFrequency.MONTHLY,
        causeTag: 'malaria',
        regionTag: 'sub-saharan',
        emergencyPool: true,
        asset: DonationAsset.USDC,
        sorobanPledgeId: 'pledge-12345',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects invalid payer address', async () => {
      const dto = plainToClass(CreatePledgeDto, {
        amount: 50.0,
        payerAddress: 'not-a-stellar-address',
        recipientId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        frequency: PledgeFrequency.MONTHLY,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const payerError = errors.find((e) => e.property === 'payerAddress');
      expect(payerError?.constraints).toHaveProperty('matches');
    });
  });

  describe('UpdatePledgeStatusDto', () => {
    it('accepts a valid status update', async () => {
      for (const status of [
        PledgeStatus.ACTIVE,
        PledgeStatus.PAUSED,
        PledgeStatus.COMPLETED,
      ]) {
        const dto = plainToClass(UpdatePledgeStatusDto, { status });
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      }
    });

    it('rejects missing status', async () => {
      const dto = plainToClass(UpdatePledgeStatusDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('status');
    });

    it('rejects invalid status value', async () => {
      const dto = plainToClass(UpdatePledgeStatusDto, {
        status: 'CANCELLED' as any,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('isEnum');
    });

    it('provides field-level error messages', async () => {
      const dto = plainToClass(UpdatePledgeStatusDto, {
        status: 'INVALID' as any,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints?.isEnum).toContain('ACTIVE');
      expect(errors[0].constraints?.isEnum).toContain('PAUSED');
      expect(errors[0].constraints?.isEnum).toContain('COMPLETED');
    });
  });
});
