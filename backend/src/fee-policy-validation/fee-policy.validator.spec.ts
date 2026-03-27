import {
  BASIS_POINTS_DENOMINATOR,
  FEE_POLICY_ERRORS,
  FLAT_FEE_MAX_STROOPS,
  INSURANCE_FEE_MAX_BP,
  MIN_NET_AMOUNT_STROOPS,
  PAYMENT_AMOUNT_MAX_STROOPS,
  PAYMENT_AMOUNT_MIN_STROOPS,
  PLATFORM_FEE_MAX_BP,
  STELLAR_BASE_FEE_STROOPS,
  STELLAR_MAX_FEE_STROOPS,
  TOTAL_FEE_CAP_BP,
} from './fee-policy.constants';
import { FeePolicyValidator } from './fee-policy.validator';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const validPolicy = {
  platformFeeBp: 100, // 1 %
  insuranceFeeBp: 50, // 0.5 %
  flatFeeStroops: 500_000, // 0.05 XLM
  stellarNetworkFeeStroops: 100,
};

const GROSS_50_XLM = 500_000_000; // 50 XLM in stroops

// ─── validatePolicyStructure ──────────────────────────────────────────────────

describe('FeePolicyValidator.validatePolicyStructure', () => {
  it('accepts a well-formed policy', () => {
    const result = FeePolicyValidator.validatePolicyStructure(validPolicy);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects platform fee above maximum', () => {
    const result = FeePolicyValidator.validatePolicyStructure({
      ...validPolicy,
      platformFeeBp: PLATFORM_FEE_MAX_BP + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.PLATFORM_FEE_ABOVE_MAX);
  });

  it('rejects negative platform fee', () => {
    const result = FeePolicyValidator.validatePolicyStructure({
      ...validPolicy,
      platformFeeBp: -1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.PLATFORM_FEE_BELOW_MIN);
  });

  it('rejects insurance fee above maximum', () => {
    const result = FeePolicyValidator.validatePolicyStructure({
      ...validPolicy,
      insuranceFeeBp: INSURANCE_FEE_MAX_BP + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.INSURANCE_FEE_ABOVE_MAX);
  });

  it('accepts insurance fee at exact maximum boundary', () => {
    const result = FeePolicyValidator.validatePolicyStructure({
      ...validPolicy,
      insuranceFeeBp: INSURANCE_FEE_MAX_BP,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects flat fee above maximum', () => {
    const result = FeePolicyValidator.validatePolicyStructure({
      ...validPolicy,
      flatFeeStroops: FLAT_FEE_MAX_STROOPS + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.FLAT_FEE_ABOVE_MAX);
  });

  it('rejects stellar network fee below base', () => {
    const result = FeePolicyValidator.validatePolicyStructure({
      ...validPolicy,
      stellarNetworkFeeStroops: STELLAR_BASE_FEE_STROOPS - 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.STELLAR_FEE_BELOW_BASE);
  });

  it('rejects stellar network fee above maximum', () => {
    const result = FeePolicyValidator.validatePolicyStructure({
      ...validPolicy,
      stellarNetworkFeeStroops: STELLAR_MAX_FEE_STROOPS + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.STELLAR_FEE_ABOVE_MAX);
  });

  it('accepts stellar network fee at exact base boundary', () => {
    const result = FeePolicyValidator.validatePolicyStructure({
      ...validPolicy,
      stellarNetworkFeeStroops: STELLAR_BASE_FEE_STROOPS,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects combined platform+insurance fee exceeding total cap', () => {
    // 10 % + 6 % = 16 % — exceeds TOTAL_FEE_CAP_BP (1500 bp = 15 %)
    const result = FeePolicyValidator.validatePolicyStructure({
      ...validPolicy,
      platformFeeBp: 1000,
      insuranceFeeBp: 600,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.TOTAL_FEE_CAP_EXCEEDED);
  });

  it('accepts combined fees exactly at the total cap boundary', () => {
    // 12 % + 3 % = 15 % = TOTAL_FEE_CAP_BP exactly
    const result = FeePolicyValidator.validatePolicyStructure({
      ...validPolicy,
      platformFeeBp: 1200,
      insuranceFeeBp: 300,
    });
    expect(result.valid).toBe(true);
  });

  it('returns multiple errors for a fully pathological config', () => {
    const result = FeePolicyValidator.validatePolicyStructure({
      platformFeeBp: PLATFORM_FEE_MAX_BP + 100, // over max
      insuranceFeeBp: INSURANCE_FEE_MAX_BP + 100, // over max
      flatFeeStroops: FLAT_FEE_MAX_STROOPS + 1, // over max
      stellarNetworkFeeStroops: 0, // below base
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('allows a zero-fee policy (free-tier)', () => {
    const result = FeePolicyValidator.validatePolicyStructure({
      platformFeeBp: 0,
      insuranceFeeBp: 0,
      flatFeeStroops: 0,
      stellarNetworkFeeStroops: STELLAR_BASE_FEE_STROOPS,
    });
    expect(result.valid).toBe(true);
  });
});

// ─── validatePaymentAmount ────────────────────────────────────────────────────

describe('FeePolicyValidator.validatePaymentAmount', () => {
  it('accepts an amount within bounds', () => {
    expect(FeePolicyValidator.validatePaymentAmount(GROSS_50_XLM).valid).toBe(
      true,
    );
  });

  it('rejects amount below minimum', () => {
    const result = FeePolicyValidator.validatePaymentAmount(
      PAYMENT_AMOUNT_MIN_STROOPS - 1,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.AMOUNT_BELOW_MIN);
  });

  it('accepts amount exactly at minimum boundary', () => {
    const result = FeePolicyValidator.validatePaymentAmount(
      PAYMENT_AMOUNT_MIN_STROOPS,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects amount above maximum', () => {
    const result = FeePolicyValidator.validatePaymentAmount(
      PAYMENT_AMOUNT_MAX_STROOPS + 1,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.AMOUNT_ABOVE_MAX);
  });

  it('accepts amount exactly at maximum boundary', () => {
    const result = FeePolicyValidator.validatePaymentAmount(
      PAYMENT_AMOUNT_MAX_STROOPS,
    );
    expect(result.valid).toBe(true);
  });
});

// ─── computeFeeComponents ─────────────────────────────────────────────────────

describe('FeePolicyValidator.computeFeeComponents', () => {
  it('correctly deducts flat fee before percentage fees', () => {
    const gross = 100_000_000; // 10 XLM
    const policy = {
      platformFeeBp: 200, // 2 %
      insuranceFeeBp: 100, // 1 %
      flatFeeStroops: 1_000_000, // 0.1 XLM flat
      stellarNetworkFeeStroops: 100,
    };

    const c = FeePolicyValidator.computeFeeComponents(gross, policy);

    const afterFlat = gross - policy.flatFeeStroops; // 99_000_000
    const expectedPlatform = Math.floor(
      (afterFlat * policy.platformFeeBp) / BASIS_POINTS_DENOMINATOR,
    ); // 1_980_000
    const expectedInsurance = Math.floor(
      (afterFlat * policy.insuranceFeeBp) / BASIS_POINTS_DENOMINATOR,
    ); // 990_000
    const expectedTotal =
      policy.flatFeeStroops +
      expectedPlatform +
      expectedInsurance +
      policy.stellarNetworkFeeStroops;
    const expectedNet = gross - expectedTotal;

    expect(c.flatFeeStroops).toBe(policy.flatFeeStroops);
    expect(c.platformFeeStroops).toBe(expectedPlatform);
    expect(c.insuranceFeeStroops).toBe(expectedInsurance);
    expect(c.stellarNetworkFeeStroops).toBe(policy.stellarNetworkFeeStroops);
    expect(c.totalFeeStroops).toBe(expectedTotal);
    expect(c.netAmountStroops).toBe(expectedNet);
  });

  it('returns full gross as net when all fees are zero (except stellar base)', () => {
    const gross = 500_000_000;
    const c = FeePolicyValidator.computeFeeComponents(gross, {
      platformFeeBp: 0,
      insuranceFeeBp: 0,
      flatFeeStroops: 0,
      stellarNetworkFeeStroops: STELLAR_BASE_FEE_STROOPS,
    });

    expect(c.platformFeeStroops).toBe(0);
    expect(c.insuranceFeeStroops).toBe(0);
    expect(c.flatFeeStroops).toBe(0);
    expect(c.netAmountStroops).toBe(gross - STELLAR_BASE_FEE_STROOPS);
  });

  it('floors fractional stroops (no rounding up)', () => {
    // 1 % of 33_333_333 = 333_333.33 → should floor to 333_333
    const gross = 33_333_333;
    const c = FeePolicyValidator.computeFeeComponents(gross, {
      ...validPolicy,
      platformFeeBp: 100, // 1 %
      insuranceFeeBp: 0,
      flatFeeStroops: 0,
    });
    const expectedPlatform = Math.floor(
      (gross * 100) / BASIS_POINTS_DENOMINATOR,
    );
    expect(c.platformFeeStroops).toBe(expectedPlatform);
  });

  it('clamps amountAfterFlat to 0 when flat fee exceeds gross', () => {
    // flat fee larger than gross — percentage fees should be 0, net negative
    const gross = 500_000;
    const c = FeePolicyValidator.computeFeeComponents(gross, {
      platformFeeBp: 100,
      insuranceFeeBp: 50,
      flatFeeStroops: 1_000_000, // larger than gross
      stellarNetworkFeeStroops: 100,
    });
    expect(c.platformFeeStroops).toBe(0);
    expect(c.insuranceFeeStroops).toBe(0);
    // net will be negative — the validation layer rejects this before submission
    expect(c.netAmountStroops).toBeLessThan(0);
  });

  it('totalFeeStroops = flatFee + platformFee + insuranceFee + stellarFee', () => {
    const c = FeePolicyValidator.computeFeeComponents(
      GROSS_50_XLM,
      validPolicy,
    );
    expect(c.totalFeeStroops).toBe(
      c.flatFeeStroops +
        c.platformFeeStroops +
        c.insuranceFeeStroops +
        c.stellarNetworkFeeStroops,
    );
  });

  it('netAmountStroops = gross - totalFees', () => {
    const c = FeePolicyValidator.computeFeeComponents(
      GROSS_50_XLM,
      validPolicy,
    );
    expect(c.netAmountStroops).toBe(GROSS_50_XLM - c.totalFeeStroops);
  });
});

// ─── validatePaymentWithPolicy ────────────────────────────────────────────────

describe('FeePolicyValidator.validatePaymentWithPolicy', () => {
  it('returns valid for a healthy payment + policy combination', () => {
    const result = FeePolicyValidator.validatePaymentWithPolicy(
      GROSS_50_XLM,
      validPolicy,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.components).not.toBeNull();
  });

  it('rejects when gross amount is below minimum', () => {
    const result = FeePolicyValidator.validatePaymentWithPolicy(
      PAYMENT_AMOUNT_MIN_STROOPS - 1,
      validPolicy,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.AMOUNT_BELOW_MIN);
    expect(result.components).toBeNull();
  });

  it('rejects when gross amount exceeds maximum', () => {
    const result = FeePolicyValidator.validatePaymentWithPolicy(
      PAYMENT_AMOUNT_MAX_STROOPS + 1,
      validPolicy,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.AMOUNT_ABOVE_MAX);
  });

  it('rejects when policy structure is invalid', () => {
    const result = FeePolicyValidator.validatePaymentWithPolicy(GROSS_50_XLM, {
      ...validPolicy,
      platformFeeBp: PLATFORM_FEE_MAX_BP + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.PLATFORM_FEE_ABOVE_MAX);
  });

  it('rejects when aggregate runtime fee cap is exceeded', () => {
    // Construct a scenario: very small payment, large flat fee → >15 % effective rate
    // 1 XLM payment, 0.5 XLM flat fee = 50 % effective (capped at struct level)
    // Use a policy with high-but-valid bp + borderline flat fee
    const tinyGross = PAYMENT_AMOUNT_MIN_STROOPS; // 0.01 XLM = 100_000 stroops
    const policyWithHighFlat = {
      platformFeeBp: 0,
      insuranceFeeBp: 0,
      flatFeeStroops: 20_000, // 20 000 stroops flat on 100 000 gross = 20 %
      stellarNetworkFeeStroops: STELLAR_BASE_FEE_STROOPS,
    };
    const result = FeePolicyValidator.validatePaymentWithPolicy(
      tinyGross,
      policyWithHighFlat,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.TOTAL_FEE_CAP_EXCEEDED);
  });

  it('rejects when net amount is negative', () => {
    // Flat fee larger than gross → net < 0
    const result = FeePolicyValidator.validatePaymentWithPolicy(
      PAYMENT_AMOUNT_MIN_STROOPS,
      {
        platformFeeBp: 0,
        insuranceFeeBp: 0,
        flatFeeStroops: PAYMENT_AMOUNT_MIN_STROOPS + 1,
        stellarNetworkFeeStroops: STELLAR_BASE_FEE_STROOPS,
      },
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(FEE_POLICY_ERRORS.NEGATIVE_NET_AMOUNT);
  });

  it('rejects when net amount falls below minimum recipient threshold', () => {
    // Craft a scenario where net > 0 but net < MIN_NET_AMOUNT_STROOPS
    // gross = 200_000 stroops, flat = 150_000, stellar = 100 → net = 49_900 < 100_000
    const result = FeePolicyValidator.validatePaymentWithPolicy(200_000, {
      platformFeeBp: 0,
      insuranceFeeBp: 0,
      flatFeeStroops: 150_000,
      stellarNetworkFeeStroops: STELLAR_BASE_FEE_STROOPS,
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e === FEE_POLICY_ERRORS.NET_AMOUNT_TOO_LOW ||
          e === FEE_POLICY_ERRORS.NEGATIVE_NET_AMOUNT ||
          e === FEE_POLICY_ERRORS.TOTAL_FEE_CAP_EXCEEDED,
      ),
    ).toBe(true);
  });

  it('provides components only on a valid result', () => {
    const valid = FeePolicyValidator.validatePaymentWithPolicy(
      GROSS_50_XLM,
      validPolicy,
    );
    expect(valid.components).not.toBeNull();
    expect(valid.components?.netAmountStroops).toBeGreaterThan(
      MIN_NET_AMOUNT_STROOPS,
    );

    const invalid = FeePolicyValidator.validatePaymentWithPolicy(
      PAYMENT_AMOUNT_MIN_STROOPS - 1,
      validPolicy,
    );
    expect(invalid.components).toBeNull();
  });

  it('net amount is deterministic across repeated calls', () => {
    const r1 = FeePolicyValidator.validatePaymentWithPolicy(
      GROSS_50_XLM,
      validPolicy,
    );
    const r2 = FeePolicyValidator.validatePaymentWithPolicy(
      GROSS_50_XLM,
      validPolicy,
    );
    expect(r1.components?.netAmountStroops).toBe(
      r2.components?.netAmountStroops,
    );
  });

  it('higher percentage fees produce lower net amounts', () => {
    const lowFeeResult = FeePolicyValidator.validatePaymentWithPolicy(
      GROSS_50_XLM,
      { ...validPolicy, platformFeeBp: 10 },
    );
    const highFeeResult = FeePolicyValidator.validatePaymentWithPolicy(
      GROSS_50_XLM,
      { ...validPolicy, platformFeeBp: 400 },
    );

    expect(lowFeeResult.valid).toBe(true);
    expect(highFeeResult.valid).toBe(true);
    expect(highFeeResult.components!.netAmountStroops).toBeLessThan(
      lowFeeResult.components!.netAmountStroops,
    );
  });

  it('larger gross amounts produce larger net amounts (same policy)', () => {
    const small = FeePolicyValidator.validatePaymentWithPolicy(
      GROSS_50_XLM,
      validPolicy,
    );
    const large = FeePolicyValidator.validatePaymentWithPolicy(
      GROSS_50_XLM * 2,
      validPolicy,
    );
    expect(large.components!.netAmountStroops).toBeGreaterThan(
      small.components!.netAmountStroops,
    );
  });
});

// ─── toBreakdownDto ───────────────────────────────────────────────────────────

describe('FeePolicyValidator.toBreakdownDto', () => {
  it('sets effectiveFeePercent with 4 decimal places and a % suffix', () => {
    const components = FeePolicyValidator.computeFeeComponents(
      GROSS_50_XLM,
      validPolicy,
    );
    const dto = FeePolicyValidator.toBreakdownDto(GROSS_50_XLM, components);

    expect(dto.effectiveFeePercent).toMatch(/^\d+\.\d{4}%$/);
  });

  it('maps all component fields into the DTO', () => {
    const components = FeePolicyValidator.computeFeeComponents(
      GROSS_50_XLM,
      validPolicy,
    );
    const dto = FeePolicyValidator.toBreakdownDto(GROSS_50_XLM, components);

    expect(dto.grossAmountStroops).toBe(GROSS_50_XLM);
    expect(dto.flatFeeStroops).toBe(components.flatFeeStroops);
    expect(dto.platformFeeStroops).toBe(components.platformFeeStroops);
    expect(dto.insuranceFeeStroops).toBe(components.insuranceFeeStroops);
    expect(dto.stellarNetworkFeeStroops).toBe(
      components.stellarNetworkFeeStroops,
    );
    expect(dto.totalFeeStroops).toBe(components.totalFeeStroops);
    expect(dto.netAmountStroops).toBe(components.netAmountStroops);
  });

  it('reports 0.0000% effective fee for zero-fee component set', () => {
    const components = FeePolicyValidator.computeFeeComponents(GROSS_50_XLM, {
      platformFeeBp: 0,
      insuranceFeeBp: 0,
      flatFeeStroops: 0,
      stellarNetworkFeeStroops: 0,
    });
    // Manually override totalFeeStroops to 0 to test the 0 gross path
    const zeroComponents = { ...components, totalFeeStroops: 0 };
    const dto = FeePolicyValidator.toBreakdownDto(GROSS_50_XLM, zeroComponents);
    expect(parseFloat(dto.effectiveFeePercent)).toBe(0);
  });

  it('handles gross = 0 without dividing by zero', () => {
    const components = {
      flatFeeStroops: 0,
      platformFeeStroops: 0,
      insuranceFeeStroops: 0,
      stellarNetworkFeeStroops: 0,
      totalFeeStroops: 0,
      netAmountStroops: 0,
    };
    expect(() =>
      FeePolicyValidator.toBreakdownDto(0, components),
    ).not.toThrow();
    const dto = FeePolicyValidator.toBreakdownDto(0, components);
    expect(dto.effectiveFeePercent).toBe('0.0000%');
  });
});

// ─── Edge cases & pathological configs ───────────────────────────────────────

describe('Pathological fee configuration edge cases', () => {
  it('rejects a policy designed to consume the entire payment', () => {
    // 5 % platform + 3 % insurance = 8 % in bp; flat = 10 XLM
    // On a 10 XLM payment the flat fee alone consumes everything
    const policy = {
      platformFeeBp: PLATFORM_FEE_MAX_BP, // 5 %
      insuranceFeeBp: INSURANCE_FEE_MAX_BP, // 3 %
      flatFeeStroops: 99_000_000, // 9.9 XLM
      stellarNetworkFeeStroops: STELLAR_BASE_FEE_STROOPS,
    };
    // Structure validation passes (all individual bounds ok, bp sum = 8 % < 15 %)
    const structResult = FeePolicyValidator.validatePolicyStructure(policy);
    expect(structResult.valid).toBe(true);

    // But runtime validation on a 10 XLM payment should fail
    const runtimeResult = FeePolicyValidator.validatePaymentWithPolicy(
      100_000_000,
      policy,
    );
    expect(runtimeResult.valid).toBe(false);
  });

  it('correctly handles maximum valid flat fee at minimum valid amount', () => {
    // Even the maximum allowed flat fee should fail on the minimum payment
    const result = FeePolicyValidator.validatePaymentWithPolicy(
      PAYMENT_AMOUNT_MIN_STROOPS,
      {
        platformFeeBp: 0,
        insuranceFeeBp: 0,
        flatFeeStroops: 50_000, // 50 % of min gross → above cap
        stellarNetworkFeeStroops: STELLAR_BASE_FEE_STROOPS,
      },
    );
    expect(result.valid).toBe(false);
  });

  it('stellar-only fee on minimum amount passes when net is sufficient', () => {
    // Minimum gross is 100_000 stroops; stellar fee is 100 → net = 99_900 ≥ MIN_NET
    const result = FeePolicyValidator.validatePaymentWithPolicy(
      PAYMENT_AMOUNT_MIN_STROOPS,
      {
        platformFeeBp: 0,
        insuranceFeeBp: 0,
        flatFeeStroops: 0,
        stellarNetworkFeeStroops: STELLAR_BASE_FEE_STROOPS,
      },
    );
    expect(result.valid).toBe(true);
    expect(result.components!.netAmountStroops).toBe(
      PAYMENT_AMOUNT_MIN_STROOPS - STELLAR_BASE_FEE_STROOPS,
    );
  });

  it('maximum valid policy on maximum valid amount passes', () => {
    // 5 % + 3 % = 8 %, well under 15 % cap
    // Net on 100 000 XLM payment should be massive
    const result = FeePolicyValidator.validatePaymentWithPolicy(
      PAYMENT_AMOUNT_MAX_STROOPS,
      {
        platformFeeBp: PLATFORM_FEE_MAX_BP,
        insuranceFeeBp: INSURANCE_FEE_MAX_BP,
        flatFeeStroops: FLAT_FEE_MAX_STROOPS,
        stellarNetworkFeeStroops: STELLAR_BASE_FEE_STROOPS,
      },
    );
    expect(result.valid).toBe(true);
    expect(result.components!.netAmountStroops).toBeGreaterThan(
      MIN_NET_AMOUNT_STROOPS,
    );
  });

  it('integer arithmetic never produces floating point net amounts', () => {
    const result = FeePolicyValidator.validatePaymentWithPolicy(
      333_333_333,
      validPolicy,
    );
    expect(result.valid).toBe(true);
    expect(Number.isInteger(result.components!.netAmountStroops)).toBe(true);
    expect(Number.isInteger(result.components!.platformFeeStroops)).toBe(true);
    expect(Number.isInteger(result.components!.insuranceFeeStroops)).toBe(true);
  });
});
