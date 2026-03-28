import { api } from './http-client';
import type { ExpirationWindow, TransferRecommendation } from '@/lib/types/expiration-forecast';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export function fetchExpirationForecast(horizonHours = 72): Promise<ExpirationWindow[]> {
  return api.get<ExpirationWindow[]>(
    `/${PREFIX}/inventory/expiration/forecast?horizonHours=${horizonHours}`,
  );
}

export function fetchRebalancingRecommendations(): Promise<TransferRecommendation[]> {
  return api.get<TransferRecommendation[]>(`/${PREFIX}/inventory/expiration/rebalancing`);
}
