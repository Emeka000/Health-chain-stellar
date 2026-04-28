import { BloodComponent } from '../../blood-units/enums/blood-component.enum';

export type BloodTypeStr = 'O-' | 'O+' | 'A-' | 'A+' | 'B-' | 'B+' | 'AB-' | 'AB+';

export interface CompatibilityRule {
  donorType: BloodTypeStr;
  recipientType: BloodTypeStr;
  component: BloodComponent;
  compatible: boolean;
  /** True when this pairing is only valid under emergency substitution policy */
  emergencyOnly: boolean;
  explanation: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  matchType: 'exact' | 'compatible' | 'emergency' | 'incompatible';
  explanation: string;
  emergencySubstitution: boolean;
}

export interface PreviewRequest {
  donorType: BloodTypeStr;
  recipientType: BloodTypeStr;
  component: BloodComponent;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  allowEmergencySubstitution?: boolean;
}
