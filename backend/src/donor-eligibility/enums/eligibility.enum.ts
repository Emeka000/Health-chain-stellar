export enum DeferralReason {
  RECENT_DONATION = 'recent_donation',
  HEALTH_SCREENING = 'health_screening',
  FLAGGED_INCIDENT = 'flagged_incident',
  AGE_RESTRICTION = 'age_restriction',
  PERMANENT_EXCLUSION = 'permanent_exclusion',
}

export enum EligibilityStatus {
  ELIGIBLE = 'eligible',
  DEFERRED = 'deferred',
  PERMANENTLY_EXCLUDED = 'permanently_excluded',
}

export enum RulePredicateType {
  AGE_RANGE = 'age_range',
  DONATION_INTERVAL = 'donation_interval',
  DEFERRAL_CHECK = 'deferral_check',
  HEALTH_SCREENING = 'health_screening',
  CUSTOM = 'custom',
}
