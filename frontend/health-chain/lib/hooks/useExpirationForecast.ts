import { useQuery } from '@tanstack/react-query';

import {
  fetchExpirationForecast,
  fetchRebalancingRecommendations,
} from '@/lib/api/expiration-forecast.api';

export function useExpirationForecast(horizonHours = 72) {
  return useQuery({
    queryKey: ['expiration-forecast', horizonHours],
    queryFn: () => fetchExpirationForecast(horizonHours),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRebalancingRecommendations() {
  return useQuery({
    queryKey: ['rebalancing-recommendations'],
    queryFn: fetchRebalancingRecommendations,
    staleTime: 5 * 60 * 1000,
  });
}
