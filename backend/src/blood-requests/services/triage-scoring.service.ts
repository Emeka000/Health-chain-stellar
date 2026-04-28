import { Injectable } from '@nestjs/common';

import {
  BloodRequestEntity,
  RequestUrgency,
  TriageFactorSnapshot,
} from '../entities/blood-request.entity';
import { ItemPriority } from '../entities/blood-request-item.entity';

export const TRIAGE_POLICY_VERSION = '2026-03-30.v1';

export interface ComputeTriageScoreInput {
  urgency: RequestUrgency;
  itemPriority: ItemPriority;
  requestedUnits: number;
  availableUnits: number;
  requiredByTimestamp: number;
  currentTimestamp: number;
  emergencyOverride?: boolean;
  policyVersion?: string;
}

export interface TriageScoreAssessment {
  score: number;
  policyVersion: string;
  factors: TriageFactorSnapshot;
}

@Injectable()
export class TriageScoringService {
  compute(input: ComputeTriageScoreInput): TriageScoreAssessment {
    const policyVersion = input.policyVersion ?? TRIAGE_POLICY_VERSION;
    const requestedUnits = Math.max(0, input.requestedUnits);
    const availableUnits = Math.max(0, input.availableUnits);
    const hoursUntilRequiredBy = Math.max(
      0,
      (input.requiredByTimestamp - input.currentTimestamp) / 3600,
    );

    const urgency = this.urgencyScore(input.urgency);
    const criticality = this.criticalityScore(input.itemPriority);
    const quantity = Math.min(100, Math.round((requestedUnits / 10) * 100));
    const time = this.timeScore(hoursUntilRequiredBy);
    const scarcity = this.scarcityScore(requestedUnits, availableUnits);
    const inventoryPressure = this.inventoryPressureScore(
      requestedUnits,
      availableUnits,
    );
    const emergencyOverride = input.emergencyOverride ?? false;

    const weightedScore = Math.round(
      urgency * 0.25 +
        criticality * 0.2 +
        quantity * 0.15 +
        time * 0.15 +
        scarcity * 0.15 +
        inventoryPressure * 0.1,
    );

    const score = emergencyOverride ? 1000 : weightedScore;

    return {
      score,
      policyVersion,
      factors: {
        policyVersion,
        urgency,
        criticality,
        quantity,
        time,
        scarcity,
        inventoryPressure,
        emergencyOverride,
        raw: {
          requestedUnits,
          availableUnits,
          hoursUntilRequiredBy,
          itemPriority: input.itemPriority,
          urgency: input.urgency,
        },
      },
    };
  }

  ensureStableSnapshot(
    request: Pick<
      BloodRequestEntity,
      'triageScore' | 'triagePolicyVersion' | 'triageFactors'
    >,
    input: ComputeTriageScoreInput,
  ): TriageScoreAssessment {
    if (
      request.triageFactors &&
      request.triagePolicyVersion &&
      typeof request.triageScore === 'number' &&
      request.triageScore > 0
    ) {
      return {
        score: request.triageScore,
        policyVersion: request.triagePolicyVersion,
        factors: request.triageFactors,
      };
    }

    return this.compute(input);
  }

  private urgencyScore(urgency: RequestUrgency): number {
    switch (urgency) {
      case RequestUrgency.CRITICAL:
        return 100;
      case RequestUrgency.URGENT:
        return 80;
      case RequestUrgency.ROUTINE:
        return 55;
      case RequestUrgency.SCHEDULED:
      default:
        return 30;
    }
  }

  private criticalityScore(priority: ItemPriority): number {
    switch (priority) {
      case ItemPriority.CRITICAL:
        return 100;
      case ItemPriority.HIGH:
        return 80;
      case ItemPriority.NORMAL:
        return 55;
      case ItemPriority.LOW:
      default:
        return 25;
    }
  }

  private timeScore(hoursUntilRequiredBy: number): number {
    if (hoursUntilRequiredBy <= 2) return 100;
    if (hoursUntilRequiredBy <= 6) return 80;
    if (hoursUntilRequiredBy <= 24) return 55;
    return 30;
  }

  private scarcityScore(requestedUnits: number, availableUnits: number): number {
    if (availableUnits <= 0) return 100;
    const ratio = requestedUnits / availableUnits;
    return Math.min(100, Math.round(ratio * 100));
  }

  private inventoryPressureScore(
    requestedUnits: number,
    availableUnits: number,
  ): number {
    if (availableUnits <= requestedUnits) return 100;
    if (availableUnits <= requestedUnits * 2) return 75;
    if (availableUnits <= requestedUnits * 4) return 45;
    return 20;
  }
}
