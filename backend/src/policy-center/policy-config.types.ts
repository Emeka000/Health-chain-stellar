export interface OperationalPolicyRules {
  anomaly: {
    duplicateEmergencyMinCount: number;
    riderMinOrders: number;
    riderCancellationRatioThreshold: number;
    disputeCountThreshold: number;
    stockSwingWindowMinutes: number;
    stockSwingMinOrders: number;
  };
  dispatch: {
    acceptanceTimeoutMs: number;
    distanceWeight: number;
    workloadWeight: number;
    ratingWeight: number;
  };
  inventory: {
    expiringSoonHours: number;
  };
  notification: {
    defaultQuietHoursEnabled: boolean;
    defaultQuietHoursStart: string;
    defaultQuietHoursEnd: string;
    defaultEmergencyBypassTier: 'normal' | 'urgent' | 'critical';
  };
  quarantine: {
    triggerMatrix: {
      temperatureBreach: {
        enabled: boolean;
        minTempC: number;
        maxTempC: number;
        autoQuarantine: boolean;
        requiredEvidence: string[];
      };
      contaminationSuspected: {
        enabled: boolean;
        autoQuarantine: boolean;
        requiredEvidence: string[];
        approvalRequired: boolean;
      };
      manualOperatorAction: {
        enabled: boolean;
        requiredEvidence: string[];
        approvalRequired: boolean;
      };
      anomalyDetection: {
        enabled: boolean;
        autoQuarantine: boolean;
        requiredEvidence: string[];
      };
    };
    dispositionRules: {
      temperatureBreach: {
        defaultDisposition: 'RELEASE' | 'DISCARD';
        autoApproveThresholdHours: number;
        requiredApprovals: number;
      };
      contaminationSuspected: {
        defaultDisposition: 'DISCARD';
        requiredApprovals: number;
      };
      manualOperatorAction: {
        defaultDisposition: 'RELEASE' | 'DISCARD';
        requiredApprovals: number;
      };
      anomalyDetection: {
        defaultDisposition: 'RELEASE' | 'DISCARD';
        autoApproveThresholdHours: number;
        requiredApprovals: number;
      };
    };
    evidenceRequirements: {
      minimumEvidenceCount: number;
      allowedEvidenceTypes: string[];
      maxEvidenceSizeMb: number;
    };
  };
}

export interface ActivePolicySnapshot {
  policyVersionId: string;
  version: number;
  policyName: string;
  rules: OperationalPolicyRules;
}
