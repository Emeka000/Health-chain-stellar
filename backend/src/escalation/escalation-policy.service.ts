import { Injectable } from '@nestjs/common';
import { RequestUrgency } from '../../blood-requests/entities/blood-request.entity';
import { EscalationTier } from '../enums/escalation-tier.enum';

export interface EscalationInput {
  urgency: RequestUrgency;
  inventoryUnits: number;
  requiredUnits: number;
  timeRemainingSeconds: number;
}

@Injectable()
export class EscalationPolicyService {
  /**
   * Derives escalation tier from urgency + inventory scarcity + time remaining.
   * TIER_3: Critical urgency OR no inventory OR SLA already breached
   * TIER_2: Urgent urgency OR inventory < 50% of required OR < 30 min remaining
   * TIER_1: Routine with low inventory (< 100% of required)
   * NONE:   Adequate supply and time
   */
  evaluate(input: EscalationInput): EscalationTier {
    const { urgency, inventoryUnits, requiredUnits, timeRemainingSeconds } = input;
    const inventoryRatio = requiredUnits > 0 ? inventoryUnits / requiredUnits : 1;
    const minutesRemaining = timeRemainingSeconds / 60;

    if (
      urgency === RequestUrgency.CRITICAL ||
      inventoryUnits === 0 ||
      timeRemainingSeconds <= 0
    ) {
      return EscalationTier.TIER_3;
    }

    if (
      urgency === RequestUrgency.URGENT ||
      inventoryRatio < 0.5 ||
      minutesRemaining < 30
    ) {
      return EscalationTier.TIER_2;
    }

    if (inventoryRatio < 1.0) {
      return EscalationTier.TIER_1;
    }

    return EscalationTier.NONE;
  }

  /** SLA deadline in ms from now based on tier */
  slaDeadlineMs(tier: EscalationTier): number {
    const now = Date.now();
    const slaMinutes: Record<EscalationTier, number> = {
      [EscalationTier.TIER_3]: 15,
      [EscalationTier.TIER_2]: 30,
      [EscalationTier.TIER_1]: 60,
      [EscalationTier.NONE]: 0,
    };
    return now + slaMinutes[tier] * 60_000;
  }
}
