import { useQuery } from '@tanstack/react-query';
import { fetchOperationsDashboard } from '@/lib/api/operations.api';
import { queryKeys } from '@/lib/api/queryKeys';

export function useDashboardData() {
  const { data, isError, isSuccess } = useQuery({
    queryKey: queryKeys.dashboard.operations,
    queryFn: fetchOperationsDashboard,
    refetchInterval: 5000, // Poll every 5 seconds for "real-time" feel
  });

  return { data, isConnected: isSuccess && !isError };
}
