import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reconciliationApi } from '../api/reconciliation.api';

export function useReconciliationRuns() {
  return useQuery({
    queryKey: ['reconciliation', 'runs'],
    queryFn: () => reconciliationApi.getRuns(),
  });
}

export function useReconciliationMismatches(params?: { runId?: string; resolution?: string }) {
  return useQuery({
    queryKey: ['reconciliation', 'mismatches', params],
    queryFn: () => reconciliationApi.getMismatches(params),
  });
}

export function useTriggerRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => reconciliationApi.triggerRun(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliation'] }),
  });
}

export function useResync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reconciliationApi.resync(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliation', 'mismatches'] }),
  });
}

export function useDismiss() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => reconciliationApi.dismiss(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliation', 'mismatches'] }),
  });
}
