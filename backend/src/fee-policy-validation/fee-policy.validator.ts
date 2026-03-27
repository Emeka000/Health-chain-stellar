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
import { FeeBreakdownDto } from './fee-policy.dto';
import { FeePolicyEntity } from './fee-policy.entity';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface FeeComponents {
  flatFeeStroops: number;
  platformFeeStroops: number;
  insuranceFeeStroops: number;
  stellarNetworkFeeStroops: number;
  totalFeeStroops: number;
  netAmountStroops: number;
}

/**
 * Pure-function fee bounds validator.
 * Zero dependencies — safe to unit-test without a database.
 */
export class FeePolicyValidator {
  /**
   * Validate a policy's structural configuration before persistence.
   * Does NOT require a gross amount — catches pathological configs at creation time.
   */
  static validatePolicyStructure(
    policy: Pick<
      FeePolicyEntity,
      | 'platformFeeBp'
      | 'insuranceFeeBp'
      | 'flatFeeStroops'
      | 'stellarNetworkFeeStroops'
    >,
  ): ValidationResult {
    const errors: string[] = [];

    if (policy.platformFeeBp > PLATFORM_FEE_MAX_BP) {
      errors.push(FEE_POLICY_ERRORS.PLATFORM_FEE_ABOVE_MAX);
    }
    if (policy.platformFeeBp < 0) {
      errors.push(FEE_POLICY_ERRORS.PLATFORM_FEE_BELOW_MIN);
    }
    if (policy.insuranceFeeBp > INSURANCE_FEE_MAX_BP) {
      errors.push(FEE_POLICY_ERRORS.INSURANCE_FEE_ABOVE_MAX);
    }
    if (policy.flatFeeStroops > FLAT_FEE_MAX_STROOPS) {
      errors.push(FEE_POLICY_ERRORS.FLAT_FEE_ABOVE_MAX);
    }
    if (policy.stellarNetworkFeeStroops < STELLAR_BASE_FEE_STROOPS) {
      errors.push(FEE_POLICY_ERRORS.STELLAR_FEE_BELOW_BASE);
    }
    if (policy.stellarNetworkFeeStroops > STELLAR_MAX_FEE_STROOPS) {
      errors.push(FEE_POLICY_ERRORS.STELLAR_FEE_ABOVE_MAX);
    }

    // Catch policies that would exceed the total-fee cap even at minimum payment
    const worstCaseTotalBp = policy.platformFeeBp + policy.insuranceFeeBp;
    if (worstCaseTotalBp > TOTAL_FEE_CAP_BP) {
      errors.push(FEE_POLICY_ERRORS.TOTAL_FEE_CAP_EXCEEDED);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a specific gross payment amount before it enters the pipeline.
   */
  static validatePaymentAmount(grossAmountStroops: number): ValidationResult {
    const errors: string[] = [];

    if (grossAmountStroops < PAYMENT_AMOUNT_MIN_STROOPS) {
      errors.push(FEE_POLICY_ERRORS.AMOUNT_BELOW_MIN);
    }
    if (grossAmountStroops > PAYMENT_AMOUNT_MAX_STROOPS) {
      errors.push(FEE_POLICY_ERRORS.AMOUNT_ABOVE_MAX);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Calculate the fee breakdown for a given gross amount + policy.
   * Returns all individual fee components and the net recipient amount.
   */
  static computeFeeComponents(
    grossAmountStroops: number,
    policy: Pick<
      FeePolicyEntity,
      | 'platformFeeBp'
      | 'insuranceFeeBp'
      | 'flatFeeStroops'
      | 'stellarNetworkFeeStroops'
    >,
  ): FeeComponents {
    // Flat fee deducted first (before percentage-based fees)
    const flatFeeStroops = policy.flatFeeStroops;

    const amountAfterFlat = Math.max(0, grossAmountStroops - flatFeeStroops);

    // Percentage fees applied to the amount after flat deduction
    const platformFeeStroops = Math.floor(
      (amountAfterFlat * policy.platformFeeBp) / BASIS_POINTS_DENOMINATOR,
    );
    const insuranceFeeStroops = Math.floor(
      (amountAfterFlat * policy.insuranceFeeBp) / BASIS_POINTS_DENOMINATOR,
    );

    const stellarNetworkFeeStroops = policy.stellarNetworkFeeStroops;

    const totalFeeStroops =
      flatFeeStroops +
      platformFeeStroops +
      insuranceFeeStroops +
      stellarNetworkFeeStroops;

    const netAmountStroops = grossAmountStroops - totalFeeStroops;

    return {
      flatFeeStroops,
      platformFeeStroops,
      insuranceFeeStroops,
      stellarNetworkFeeStroops,
      totalFeeStroops,
      netAmountStroops,
    };
  }

  /**
   * Full runtime validation: combines amount check, fee computation, and
   * net-amount sanity checks.  Call this immediately before submitting a
   * payment to the Stellar network.
   */
  static validatePaymentWithPolicy(
    grossAmountStroops: number,
    policy: Pick<
      FeePolicyEntity,
      | 'platformFeeBp'
      | 'insuranceFeeBp'
      | 'flatFeeStroops'
      | 'stellarNetworkFeeStroops'
    >,
  ): { valid: boolean; errors: string[]; components: FeeComponents | null } {
    const errors: string[] = [];

    // 1. Amount bounds
    const amountCheck =
      FeePolicyValidator.validatePaymentAmount(grossAmountStroops);
    errors.push(...amountCheck.errors);

    // 2. Policy structure
    const structureCheck = FeePolicyValidator.validatePolicyStructure(policy);
    errors.push(...structureCheck.errors);

    if (errors.length > 0) {
      return { valid: false, errors, components: null };
    }

    // 3. Compute components
    const components = FeePolicyValidator.computeFeeComponents(
      grossAmountStroops,
      policy,
    );

    // 4. Aggregate fee cap (runtime, specific to this amount)
    const totalFeeBp = Math.floor(
      (components.totalFeeStroops * BASIS_POINTS_DENOMINATOR) /
        grossAmountStroops,
    );
    if (totalFeeBp > TOTAL_FEE_CAP_BP) {
      errors.push(FEE_POLICY_ERRORS.TOTAL_FEE_CAP_EXCEEDED);
    }

    // 5. Net amount guards
    if (components.netAmountStroops < 0) {
      errors.push(FEE_POLICY_ERRORS.NEGATIVE_NET_AMOUNT);
    } else if (components.netAmountStroops === 0) {
      errors.push(FEE_POLICY_ERRORS.PATHOLOGICAL_ZERO_NET);
    } else if (components.netAmountStroops < MIN_NET_AMOUNT_STROOPS) {
      errors.push(FEE_POLICY_ERRORS.NET_AMOUNT_TOO_LOW);
    }

    return {
      valid: errors.length === 0,
      errors,
      components: errors.length === 0 ? components : null,
    };
  }

  /**
   * Build a human-readable FeeBreakdownDto from computed components.
   */
  static toBreakdownDto(
    grossAmountStroops: number,
    components: FeeComponents,
  ): FeeBreakdownDto {
    const effectiveFeePercent =
      grossAmountStroops > 0
        ? ((components.totalFeeStroops / grossAmountStroops) * 100).toFixed(4)
        : '0.0000';

    return {
      grossAmountStroops,
      flatFeeStroops: components.flatFeeStroops,
      platformFeeStroops: components.platformFeeStroops,
      insuranceFeeStroops: components.insuranceFeeStroops,
      stellarNetworkFeeStroops: components.stellarNetworkFeeStroops,
      totalFeeStroops: components.totalFeeStroops,
      netAmountStroops: components.netAmountStroops,
      effectiveFeePercent: `${effectiveFeePercent}%`,
    };
  }
}
