export type ReadinessEntityType = 'partner' | 'region';
export type ReadinessChecklistStatus = 'incomplete' | 'ready' | 'signed_off';
export type ReadinessItemStatus = 'pending' | 'complete' | 'waived';
export type ReadinessItemKey =
  | 'licensing'
  | 'staffing'
  | 'storage'
  | 'transport_coverage'
  | 'notification_setup'
  | 'permissions'
  | 'wallet_linkage'
  | 'emergency_contacts';

export interface ReadinessItem {
  id: string;
  itemKey: ReadinessItemKey;
  status: ReadinessItemStatus;
  evidenceUrl: string | null;
  notes: string | null;
  completedAt: string | null;
  completedBy: string | null;
}

export interface ReadinessChecklist {
  id: string;
  entityType: ReadinessEntityType;
  entityId: string;
  status: ReadinessChecklistStatus;
  signedOffBy: string | null;
  signedOffAt: string | null;
  reviewerNotes: string | null;
  items: ReadinessItem[];
  createdAt: string;
  updatedAt: string;
}
