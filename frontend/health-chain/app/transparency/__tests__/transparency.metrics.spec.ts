import { describe, it, expect } from 'vitest';
import type { PublicMetrics } from '../../../lib/api/transparency.api';

const SAMPLE_METRICS: PublicMetrics = {
  fulfilledRequests: 312,
  avgResponseTimeHours: 3.2,
  totalDonationsRecorded: 890,
  verifiedPartners: 14,
  onChainVerifiedOrgs: 9,
  bloodTypeBreakdown: { 'A+': 80, 'O-': 55, 'B+': 40, 'AB+': 20 },
  geographicCoverage: [
    { region: 'Lagos', fulfilledRequests: 120, verifiedPartners: 5 },
    { region: 'Abuja', fulfilledRequests: 80, verifiedPartners: 3 },
  ],
  generatedAt: '2024-01-15T10:00:00.000Z',
};

// ── Transformation helpers (mirrors display logic in TransparencyDashboard) ──

function formatAvgResponseTime(hours: number | null): string {
  return hours !== null ? `${hours}h` : '—';
}

function buildBloodTypeChartData(breakdown: Record<string, number>) {
  return Object.entries(breakdown).map(([type, count]) => ({ type, count }));
}

function buildRegionTableRows(coverage: PublicMetrics['geographicCoverage']) {
  return coverage.slice(0, 8);
}

function assertNoSensitiveFields(metrics: PublicMetrics) {
  const json = JSON.stringify(metrics);
  const forbidden = ['donorId', 'hospitalId', 'riderId', 'patientId', 'email', 'phone'];
  return forbidden.filter((f) => json.includes(f));
}

// ── Tests ──

describe('Transparency metrics transformations', () => {
  it('formatAvgResponseTime renders hours with suffix', () => {
    expect(formatAvgResponseTime(3.2)).toBe('3.2h');
    expect(formatAvgResponseTime(0)).toBe('0h');
  });

  it('formatAvgResponseTime renders dash when null', () => {
    expect(formatAvgResponseTime(null)).toBe('—');
  });

  it('buildBloodTypeChartData maps breakdown to chart-ready array', () => {
    const result = buildBloodTypeChartData(SAMPLE_METRICS.bloodTypeBreakdown);
    expect(result).toMatchSnapshot();
    expect(result.every((r) => typeof r.type === 'string' && typeof r.count === 'number')).toBe(true);
  });

  it('buildRegionTableRows caps at 8 entries', () => {
    const longCoverage = Array.from({ length: 12 }, (_, i) => ({
      region: `Region ${i}`,
      fulfilledRequests: i * 10,
      verifiedPartners: i,
    }));
    const rows = buildRegionTableRows(longCoverage);
    expect(rows).toHaveLength(8);
    expect(rows).toMatchSnapshot();
  });

  it('sample metrics contain no sensitive personal fields', () => {
    const leaks = assertNoSensitiveFields(SAMPLE_METRICS);
    expect(leaks).toHaveLength(0);
  });

  it('full metrics object matches snapshot', () => {
    expect({ ...SAMPLE_METRICS, generatedAt: '<timestamp>' }).toMatchSnapshot();
  });

  it('onChainVerifiedOrgs is a subset of verifiedPartners', () => {
    expect(SAMPLE_METRICS.onChainVerifiedOrgs).toBeLessThanOrEqual(
      SAMPLE_METRICS.verifiedPartners,
    );
  });

  it('bloodTypeBreakdown values are all non-negative integers', () => {
    for (const count of Object.values(SAMPLE_METRICS.bloodTypeBreakdown)) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(count)).toBe(true);
    }
  });
});
