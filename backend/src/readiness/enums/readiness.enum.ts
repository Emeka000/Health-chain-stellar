export enum ReadinessItemKey {
  LICENSING = 'licensing',
  STAFFING = 'staffing',
  STORAGE = 'storage',
  TRANSPORT_COVERAGE = 'transport_coverage',
  NOTIFICATION_SETUP = 'notification_setup',
  PERMISSIONS = 'permissions',
  WALLET_LINKAGE = 'wallet_linkage',
  EMERGENCY_CONTACTS = 'emergency_contacts',
}

export enum ReadinessItemStatus {
  PENDING = 'pending',
  COMPLETE = 'complete',
  WAIVED = 'waived',
}

export enum ReadinessChecklistStatus {
  INCOMPLETE = 'incomplete',
  READY = 'ready',
  SIGNED_OFF = 'signed_off',
}

export enum ReadinessEntityType {
  PARTNER = 'partner',
  REGION = 'region',
}
