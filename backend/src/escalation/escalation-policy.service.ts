import { Injectable } from '@nestjs/common';
import { RequestUrgency } from '../../blood-requests/entities/blood-request.entity';
import { EscalationTier } from '../enums/escalation-tier.enum';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';

export interface EscalationInput {
  urgency: RequestUrgency;
  inventoryUnits: number;
  requiredUnits: number;
  timeRemainingSeconds: number;
}

export interface EscalationPolicyLevel {
  level: number;
  targetRole: 'HOSPITAL_COORDINATOR' | 'REGIONAL_OPS_MANAGER' | 'NATIONAL_COMMAND';
  timeoutSeconds: number;
  actions: NotificationChannel[];
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

  buildPolicyChain(urgency: RequestUrgency, tier: EscalationTier): EscalationPolicyLevel[] {
    const isHighSeverity =
      urgency === RequestUrgency.CRITICAL ||
      tier === EscalationTier.TIER_3 ||
      tier === EscalationTier.TIER_2;

    if (isHighSeverity) {
      return [
        {
          level: 1,
          targetRole: 'HOSPITAL_COORDINATOR',
          timeoutSeconds: 5 * 60,
          actions: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
        },
        {
          level: 2,
          targetRole: 'REGIONAL_OPS_MANAGER',
          timeoutSeconds: 7 * 60,
          actions: [NotificationChannel.PUSH, NotificationChannel.SMS],
        },
        {
          level: 3,
          targetRole: 'NATIONAL_COMMAND',
          timeoutSeconds: 10 * 60,
          actions: [NotificationChannel.SMS, NotificationChannel.IN_APP],
        },
      ];
    }

    return [
      {
        level: 1,
        targetRole: 'HOSPITAL_COORDINATOR',
        timeoutSeconds: 10 * 60,
        actions: [NotificationChannel.IN_APP],
      },
      {
        level: 2,
        targetRole: 'REGIONAL_OPS_MANAGER',
        timeoutSeconds: 15 * 60,
        actions: [NotificationChannel.PUSH],
      },
    ];
  }

  suppressionWindowMs(urgency: RequestUrgency): number {
    if (urgency === RequestUrgency.CRITICAL) return 5 * 60_000;
    if (urgency === RequestUrgency.URGENT) return 10 * 60_000;
    return 15 * 60_000;
  }
}
