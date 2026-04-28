import { useQuery } from '@tanstack/react-query';
import { custodyApi } from '../api/custody.api';

export function useUnitCustodyTimeline(bloodUnitId: string) {
  return useQuery({
    queryKey: ['custody', 'unit', bloodUnitId],
    queryFn: () => custodyApi.getUnitTimeline(bloodUnitId),
    enabled: !!bloodUnitId,
  });
}

export function useOrderCustodyTimeline(orderId: string) {
  return useQuery({
    queryKey: ['custody', 'order', orderId],
    queryFn: () => custodyApi.getOrderTimeline(orderId),
    enabled: !!orderId,
  });
}
