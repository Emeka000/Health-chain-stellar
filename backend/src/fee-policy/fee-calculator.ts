import { UrgencyTier } from '../orders/enums/urgency-tier.enum';

export interface FeePolicyLike {
  deliveryFeeRate?: number | string | null;
  platformFeePct?: number | string | null;
  performanceMultiplier?: number | string | null;
  fixedFee?: number | string | null;
  minDistanceKm?: number | string | null;
  waivedFor?: string | null;
}

export interface FeeCalculationInput {
  quantity: number | string;
  distanceKm?: number | string | null;
  urgencyTier?: UrgencyTier | string | null;
  partnerId?: string | null;
}

export interface FeeCalculationStep {
  step: string;
  description: string;
  value?: number;
  metadata?: Record<string, unknown>;
}

export interface FeeCalculationResult {
  baseAmount: number;
  deliveryFee: number;
  platformFee: number;
  performanceFee: number;
  fixedFee: number;
  totalFee: number;
  waived: boolean;
  steps: FeeCalculationStep[];
}

function toNumber(value: number | string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function calculateFee(
  policy: FeePolicyLike,
  input: FeeCalculationInput,
): FeeCalculationResult {
  const steps: FeeCalculationStep[] = [];

  const quantity = toNumber(input.quantity, 0);
  const distanceKm = toNumber(input.distanceKm, 0);
  const deliveryFeeRate = toNumber(policy.deliveryFeeRate, 0);
  const platformFeePct = toNumber(policy.platformFeePct, 0);
  const performanceMultiplier = toNumber(policy.performanceMultiplier, 1);
  const fixedFee = toNumber(policy.fixedFee, 0);
  const minDistanceKm = toNumber(policy.minDistanceKm, 0);

  const baseAmount = quantity * 100;
  steps.push({
    step: 'BASE_AMOUNT',
    description: `Base amount = quantity (${quantity}) * 100`,
    value: baseAmount,
  });

  const effectiveDistanceKm = Math.max(distanceKm, minDistanceKm);
  let deliveryFee = effectiveDistanceKm * deliveryFeeRate;
  steps.push({
    step: 'DELIVERY_FEE',
    description: `Delivery fee = distance (${effectiveDistanceKm} km) * rate (${deliveryFeeRate})`,
    value: deliveryFee,
    metadata: { distanceKm: effectiveDistanceKm, deliveryFeeRate },
  });

  let platformFee = baseAmount * (platformFeePct / 100);
  steps.push({
    step: 'PLATFORM_FEE',
    description: `Platform fee = base amount (${baseAmount}) * ${platformFeePct}%`,
    value: platformFee,
    metadata: { platformFeePct },
  });

  const performanceFee = baseAmount * (performanceMultiplier - 1);
  steps.push({
    step: 'PERFORMANCE_FEE',
    description: `Performance fee = base amount (${baseAmount}) * (multiplier (${performanceMultiplier}) - 1)`,
    value: performanceFee,
    metadata: { performanceMultiplier },
  });

  steps.push({
    step: 'FIXED_FEE',
    description: `Fixed fee = ${fixedFee}`,
    value: fixedFee,
  });

  const waivedFor = policy.waivedFor ?? null;
  const partnerId = input.partnerId ?? null;
  const urgencyTier = input.urgencyTier ?? null;

  const partnerWaiver = waivedFor !== null && partnerId !== null && waivedFor === partnerId;
  const emergencyWaiver =
    waivedFor !== null && waivedFor === 'emergency' && urgencyTier === UrgencyTier.EMERGENCY;
  const waived = partnerWaiver || emergencyWaiver;

  if (waived) {
    const waivedDeliveryFee = deliveryFee;
    const waivedPlatformFee = platformFee;
    deliveryFee = 0;
    platformFee = 0;
    steps.push({
      step: 'WAIVED',
      description: partnerWaiver
        ? `Fees waived for partner ${partnerId}`
        : 'Fees waived for emergency urgency tier',
      value: waivedDeliveryFee + waivedPlatformFee,
      metadata: {
        waivedFor,
        partnerId,
        urgencyTier,
        waivedDeliveryFee,
        waivedPlatformFee,
      },
    });
  }

  const totalFee = deliveryFee + platformFee + performanceFee + fixedFee;
  steps.push({
    step: 'TOTAL_FEE',
    description: `Total fee = delivery (${deliveryFee}) + platform (${platformFee}) + performance (${performanceFee}) + fixed (${fixedFee})`,
    value: totalFee,
  });

  return {
    baseAmount,
    deliveryFee,
    platformFee,
    performanceFee,
    fixedFee,
    totalFee,
    waived,
    steps,
  };
}