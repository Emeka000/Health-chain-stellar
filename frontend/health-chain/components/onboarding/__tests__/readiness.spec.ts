import { describe, it, expect } from 'vitest';
import type { ReadinessChecklist, ReadinessItemKey } from '../../../lib/types/readiness';

// ── Pure display logic helpers mirroring ReadinessDashboard ──

const ITEM_LABELS: Record<ReadinessItemKey, string> = {
  licensing: 'Licensing',
  staffing: 'Staffing',
  storage: 'Storage',
  transport_coverage: 'Transport Coverage',
  notification_setup: 'Notification Setup',
  permissions: 'Permissions',
  wallet_linkage: 'Wallet Linkage',
  emergency_contacts: 'Emergency Contacts',
};

function countPending(checklist: ReadinessChecklist): number {
  return checklist.items.filter((i) => i.status === 'pending').length;
}

function isBlockedFromActivation(checklist: ReadinessChecklist): boolean {
  return checklist.status !== 'signed_off';
}

function canSignOff(checklist: ReadinessChecklist): boolean {
  return checklist.status === 'ready';
}

function filterByType(
  checklists: ReadinessChecklist[],
  type: 'all' | 'partner' | 'region',
): ReadinessChecklist[] {
  return type === 'all' ? checklists : checklists.filter((c) => c.entityType === type);
}

function makeChecklist(overrides: Partial<ReadinessChecklist> = {}): ReadinessChecklist {
  return {
    id: 'cl-1',
    entityType: 'partner',
    entityId: 'org-1',
    status: 'incomplete',
    signedOffBy: null,
    signedOffAt: null,
    reviewerNotes: null,
    items: [
      { id: 'i1', itemKey: 'licensing', status: 'pending', evidenceUrl: null, notes: null, completedAt: null, completedBy: null },
      { id: 'i2', itemKey: 'staffing', status: 'complete', evidenceUrl: null, notes: null, completedAt: new Date().toISOString(), completedBy: 'user-1' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ReadinessDashboard display logic', () => {
  describe('countPending', () => {
    it('counts only pending items', () => {
      expect(countPending(makeChecklist())).toBe(1);
    });

    it('returns 0 when all items complete', () => {
      const c = makeChecklist({
        items: [
          { id: 'i1', itemKey: 'licensing', status: 'complete', evidenceUrl: null, notes: null, completedAt: null, completedBy: null },
        ],
      });
      expect(countPending(c)).toBe(0);
    });
  });

  describe('isBlockedFromActivation', () => {
    it('blocks incomplete checklists', () => {
      expect(isBlockedFromActivation(makeChecklist({ status: 'incomplete' }))).toBe(true);
    });

    it('blocks ready (not yet signed off) checklists', () => {
      expect(isBlockedFromActivation(makeChecklist({ status: 'ready' }))).toBe(true);
    });

    it('does not block signed-off checklists', () => {
      expect(isBlockedFromActivation(makeChecklist({ status: 'signed_off' }))).toBe(false);
    });
  });

  describe('canSignOff', () => {
    it('allows sign-off only when status is ready', () => {
      expect(canSignOff(makeChecklist({ status: 'ready' }))).toBe(true);
      expect(canSignOff(makeChecklist({ status: 'incomplete' }))).toBe(false);
      expect(canSignOff(makeChecklist({ status: 'signed_off' }))).toBe(false);
    });
  });

  describe('filterByType', () => {
    const checklists = [
      makeChecklist({ id: '1', entityType: 'partner' }),
      makeChecklist({ id: '2', entityType: 'region' }),
      makeChecklist({ id: '3', entityType: 'partner' }),
    ];

    it('returns all for "all" filter', () => {
      expect(filterByType(checklists, 'all')).toHaveLength(3);
    });

    it('filters to partner only', () => {
      expect(filterByType(checklists, 'partner')).toHaveLength(2);
    });

    it('filters to region only', () => {
      expect(filterByType(checklists, 'region')).toHaveLength(1);
    });
  });

  describe('ITEM_LABELS', () => {
    it('has a label for every item key', () => {
      const keys: ReadinessItemKey[] = [
        'licensing', 'staffing', 'storage', 'transport_coverage',
        'notification_setup', 'permissions', 'wallet_linkage', 'emergency_contacts',
      ];
      for (const key of keys) {
        expect(ITEM_LABELS[key]).toBeTruthy();
      }
    });
  });
});
