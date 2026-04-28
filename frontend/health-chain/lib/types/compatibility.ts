export type BloodTypeStr = 'O-' | 'O+' | 'A-' | 'A+' | 'B-' | 'B+' | 'AB-' | 'AB+';
export type BloodComponent =
  | 'WHOLE_BLOOD'
  | 'RED_CELLS'
  | 'PLATELETS'
  | 'PLASMA'
  | 'CRYOPRECIPITATE'
  | 'FRESH_FROZEN_PLASMA';
export type Urgency = 'low' | 'medium' | 'high' | 'critical';

export interface PreviewRequest {
  donorType: BloodTypeStr;
  recipientType: BloodTypeStr;
  component: BloodComponent;
  urgency: Urgency;
  allowEmergencySubstitution?: boolean;
}

export interface CompatibilityResult {
  compatible: boolean;
  matchType: 'exact' | 'compatible' | 'emergency' | 'incompatible';
  explanation: string;
  emergencySubstitution: boolean;
}
