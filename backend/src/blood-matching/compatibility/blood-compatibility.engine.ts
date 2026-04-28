import { Injectable } from '@nestjs/common';
import { BloodComponent } from '../../blood-units/enums/blood-component.enum';
import type {
  BloodTypeStr,
  CompatibilityResult,
  PreviewRequest,
} from './compatibility.types';

/**
 * ABO/Rh donors that are safe for each recipient type, per component.
 *
 * Rules:
 *  - WHOLE_BLOOD / RED_CELLS: strict ABO+Rh matching (Rh- can receive Rh- only)
 *  - PLASMA: ABO-reverse (AB plasma is universal donor; O plasma is universal recipient)
 *  - PLATELETS: ABO-preferred but Rh-flexible; emergency allows any
 *  - CRYOPRECIPITATE / FRESH_FROZEN_PLASMA: same as PLASMA
 */

type CompatMatrix = Record<BloodTypeStr, BloodTypeStr[]>;

// Standard (non-emergency) compatible donors per recipient, by component group
const RED_CELL_MATRIX: CompatMatrix = {
  'O-':  ['O-'],
  'O+':  ['O-', 'O+'],
  'A-':  ['O-', 'A-'],
  'A+':  ['O-', 'O+', 'A-', 'A+'],
  'B-':  ['O-', 'B-'],
  'B+':  ['O-', 'O+', 'B-', 'B+'],
  'AB-': ['O-', 'A-', 'B-', 'AB-'],
  'AB+': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
};

// Plasma: ABO-reverse — AB is universal plasma donor
const PLASMA_MATRIX: CompatMatrix = {
  'O-':  ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+':  ['O+', 'A+', 'B+', 'AB+'],
  'A-':  ['A-', 'A+', 'AB-', 'AB+'],
  'A+':  ['A+', 'AB+'],
  'B-':  ['B-', 'B+', 'AB-', 'AB+'],
  'B+':  ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+'],
};

// Emergency-only substitutions for red cells (O- universal donor)
const EMERGENCY_RED_CELL_DONORS: BloodTypeStr[] = ['O-'];

// Emergency-only substitutions for plasma (AB+ universal plasma donor)
const EMERGENCY_PLASMA_DONORS: BloodTypeStr[] = ['AB+', 'AB-'];

function isRhNegative(t: BloodTypeStr): boolean {
  return t.endsWith('-');
}

@Injectable()
export class BloodCompatibilityEngine {
  /**
   * Evaluate whether a donor unit is compatible with a recipient,
   * for a given component and policy settings.
   */
  check(
    donorType: BloodTypeStr,
    recipientType: BloodTypeStr,
    component: BloodComponent,
    allowEmergencySubstitution = false,
  ): CompatibilityResult {
    if (donorType === recipientType) {
      return {
        compatible: true,
        matchType: 'exact',
        emergencySubstitution: false,
        explanation: `Exact match: donor ${donorType} is identical to recipient ${recipientType} for ${component}.`,
      };
    }

    const matrix = this.matrixFor(component);
    const standardDonors = matrix[recipientType] ?? [];

    if (standardDonors.includes(donorType)) {
      return {
        compatible: true,
        matchType: 'compatible',
        emergencySubstitution: false,
        explanation: this.buildExplanation(donorType, recipientType, component, false),
      };
    }

    // Emergency substitution check
    if (allowEmergencySubstitution) {
      const emergencyDonors = this.emergencyDonorsFor(component);
      if (emergencyDonors.includes(donorType)) {
        return {
          compatible: true,
          matchType: 'emergency',
          emergencySubstitution: true,
          explanation: this.buildExplanation(donorType, recipientType, component, true),
        };
      }
    }

    return {
      compatible: false,
      matchType: 'incompatible',
      emergencySubstitution: false,
      explanation: this.buildIncompatibleExplanation(donorType, recipientType, component),
    };
  }

  /** Return all compatible donor types for a recipient + component */
  compatibleDonors(
    recipientType: BloodTypeStr,
    component: BloodComponent,
    allowEmergencySubstitution = false,
  ): Array<{ donorType: BloodTypeStr; matchType: string; explanation: string }> {
    const matrix = this.matrixFor(component);
    const standard = (matrix[recipientType] ?? []) as BloodTypeStr[];
    const results = standard.map((d) => ({
      donorType: d,
      matchType: d === recipientType ? 'exact' : 'compatible',
      explanation: this.buildExplanation(d, recipientType, component, false),
    }));

    if (allowEmergencySubstitution) {
      const emergency = this.emergencyDonorsFor(component).filter(
        (d) => !standard.includes(d),
      );
      emergency.forEach((d) =>
        results.push({
          donorType: d,
          matchType: 'emergency',
          explanation: this.buildExplanation(d, recipientType, component, true),
        }),
      );
    }

    return results;
  }

  /** Full preview used by the admin tool */
  preview(req: PreviewRequest): CompatibilityResult {
    const isEmergency = req.urgency === 'critical' && req.allowEmergencySubstitution !== false;
    return this.check(req.donorType, req.recipientType, req.component, isEmergency);
  }

  /** Return the full compatibility matrix for a component (for snapshot tests) */
  matrixFor(component: BloodComponent): CompatMatrix {
    switch (component) {
      case BloodComponent.PLASMA:
      case BloodComponent.FRESH_FROZEN_PLASMA:
      case BloodComponent.CRYOPRECIPITATE:
        return PLASMA_MATRIX;
      // Platelets follow red-cell ABO rules but Rh is flexible in standard use
      case BloodComponent.PLATELETS:
      case BloodComponent.WHOLE_BLOOD:
      case BloodComponent.RED_CELLS:
      default:
        return RED_CELL_MATRIX;
    }
  }

  private emergencyDonorsFor(component: BloodComponent): BloodTypeStr[] {
    switch (component) {
      case BloodComponent.PLASMA:
      case BloodComponent.FRESH_FROZEN_PLASMA:
      case BloodComponent.CRYOPRECIPITATE:
        return EMERGENCY_PLASMA_DONORS;
      default:
        return EMERGENCY_RED_CELL_DONORS;
    }
  }

  private buildExplanation(
    donor: BloodTypeStr,
    recipient: BloodTypeStr,
    component: BloodComponent,
    emergency: boolean,
  ): string {
    const prefix = emergency ? '[Emergency substitution] ' : '';
    const componentLabel = component.replace(/_/g, ' ').toLowerCase();

    if (component === BloodComponent.PLASMA || component === BloodComponent.FRESH_FROZEN_PLASMA) {
      return `${prefix}${donor} plasma is ABO-compatible for ${recipient} recipient (plasma uses reverse ABO rules; AB is universal plasma donor).`;
    }

    const donorRh = isRhNegative(donor) ? 'Rh-negative' : 'Rh-positive';
    const recipientRh = isRhNegative(recipient) ? 'Rh-negative' : 'Rh-positive';
    const rhNote =
      isRhNegative(recipient) && !isRhNegative(donor)
        ? ' Rh-positive donor to Rh-negative recipient is only permitted under emergency policy.'
        : ` ${donorRh} donor is safe for ${recipientRh} recipient.`;

    return `${prefix}${donor} ${componentLabel} is ABO-compatible for ${recipient} recipient.${rhNote}`;
  }

  private buildIncompatibleExplanation(
    donor: BloodTypeStr,
    recipient: BloodTypeStr,
    component: BloodComponent,
  ): string {
    const componentLabel = component.replace(/_/g, ' ').toLowerCase();
    return (
      `${donor} ${componentLabel} is NOT compatible with ${recipient} recipient. ` +
      `ABO or Rh antigen mismatch would risk a transfusion reaction. ` +
      `Enable emergency substitution policy to allow O- universal donor units.`
    );
  }
}
