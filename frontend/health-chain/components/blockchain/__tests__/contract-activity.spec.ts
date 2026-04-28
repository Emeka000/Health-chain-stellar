import { describe, it, expect } from 'vitest';
import type { ContractDomain, ContractEvent } from '../../../lib/types/contract-events';

// ── Pure display logic helpers mirroring ContractActivityFeed ──

const DOMAIN_COLORS: Record<ContractDomain, string> = {
  identity: 'bg-blue-100 text-blue-700',
  request: 'bg-purple-100 text-purple-700',
  inventory: 'bg-green-100 text-green-700',
  delivery: 'bg-orange-100 text-orange-700',
  payment: 'bg-emerald-100 text-emerald-700',
};

function getDomainColor(domain: ContractDomain): string {
  return DOMAIN_COLORS[domain] ?? 'bg-gray-100 text-gray-700';
}

function truncateTxHash(hash: string | null): string {
  if (!hash) return '—';
  return `${hash.slice(0, 12)}…`;
}

function filterByDomain(
  events: ContractEvent[],
  domain: ContractDomain | 'all',
): ContractEvent[] {
  return domain === 'all' ? events : events.filter((e) => e.domain === domain);
}

function makeEvent(overrides: Partial<ContractEvent> = {}): ContractEvent {
  return {
    id: 'evt-1',
    domain: 'payment',
    eventType: 'payment.released',
    contractRef: 'CXXX',
    ledgerSequence: 1000,
    txHash: 'abcdef1234567890',
    payload: { amount: 100 },
    entityRef: 'order-1',
    indexedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ContractActivityFeed display logic', () => {
  describe('getDomainColor', () => {
    it('returns correct class for each domain', () => {
      expect(getDomainColor('payment')).toContain('emerald');
      expect(getDomainColor('identity')).toContain('blue');
      expect(getDomainColor('delivery')).toContain('orange');
      expect(getDomainColor('inventory')).toContain('green');
      expect(getDomainColor('request')).toContain('purple');
    });
  });

  describe('truncateTxHash', () => {
    it('truncates long hash to 12 chars + ellipsis', () => {
      expect(truncateTxHash('abcdef1234567890')).toBe('abcdef123456…');
    });

    it('returns dash for null hash', () => {
      expect(truncateTxHash(null)).toBe('—');
    });
  });

  describe('filterByDomain', () => {
    const events = [
      makeEvent({ id: '1', domain: 'payment' }),
      makeEvent({ id: '2', domain: 'delivery' }),
      makeEvent({ id: '3', domain: 'identity' }),
    ];

    it('returns all events for "all" filter', () => {
      expect(filterByDomain(events, 'all')).toHaveLength(3);
    });

    it('filters to specific domain', () => {
      const result = filterByDomain(events, 'payment');
      expect(result).toHaveLength(1);
      expect(result[0].domain).toBe('payment');
    });

    it('returns empty array when no match', () => {
      expect(filterByDomain(events, 'inventory')).toHaveLength(0);
    });
  });

  describe('event shape', () => {
    it('event has required fields', () => {
      const e = makeEvent();
      expect(e).toHaveProperty('id');
      expect(e).toHaveProperty('domain');
      expect(e).toHaveProperty('eventType');
      expect(e).toHaveProperty('ledgerSequence');
      expect(e).toHaveProperty('indexedAt');
    });

    it('entityRef can be null', () => {
      const e = makeEvent({ entityRef: null });
      expect(e.entityRef).toBeNull();
    });
  });
});
