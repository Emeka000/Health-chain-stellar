const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export interface RegionSummary {
  region: string;
  fulfilledRequests: number;
  verifiedPartners: number;
}

export interface PublicMetrics {
  fulfilledRequests: number;
  avgResponseTimeHours: number | null;
  totalDonationsRecorded: number;
  verifiedPartners: number;
  onChainVerifiedOrgs: number;
  bloodTypeBreakdown: Record<string, number>;
  geographicCoverage: RegionSummary[];
  generatedAt: string;
}

export async function fetchPublicMetrics(): Promise<PublicMetrics> {
  const res = await fetch(`${API_BASE_URL}/${PREFIX}/transparency/metrics`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Failed to fetch transparency metrics: ${res.status}`);
  return res.json() as Promise<PublicMetrics>;
}
