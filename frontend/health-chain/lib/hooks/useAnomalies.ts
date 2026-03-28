import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { fetchAnomalies, reviewAnomaly } from '@/lib/api/anomaly.api';
import { queryKeys } from '@/lib/api/queryKeys';
import type { AnomalyQueryParams, ReviewAnomalyPayload } from '@/lib/types/anomaly';

export function useAnomalies(params: AnomalyQueryParams) {
  return useQuery({
    queryKey: queryKeys.anomalies.list(params),
    queryFn: () => fetchAnomalies(params),
  });
}

export function useReviewAnomaly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReviewAnomalyPayload }) =>
      reviewAnomaly(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.anomalies.all }),
  });
}
