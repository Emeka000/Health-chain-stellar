import { useQuery } from '@tanstack/react-query';
import { fetchBreachSummary } from '@/lib/api/sla.api';
import type { SlaBreachQuery } from '@/lib/types/sla';

export function useSlaBreachSummary(
  dimension: 'by-hospital' | 'by-blood-bank' | 'by-rider' | 'by-urgency',
  params: SlaBreachQuery = {},
) {
  return useQuery({
    queryKey: ['sla', 'summary', dimension, params],
    queryFn: () => fetchBreachSummary(dimension, params),
    placeholderData: (prev) => prev,
  });
}
