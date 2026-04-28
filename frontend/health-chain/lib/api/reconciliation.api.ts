import { api } from './http-client';
import type { ReconciliationRun, ReconciliationMismatch } from '../types/reconciliation';

export const reconciliationApi = {
  triggerRun: () => api.post<ReconciliationRun>('/reconciliation/runs', {}),
  getRuns: (limit = 20) => api.get<ReconciliationRun[]>(`/reconciliation/runs?limit=${limit}`),
  getMismatches: (params?: { runId?: string; resolution?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.runId) q.set('runId', params.runId);
    if (params?.resolution) q.set('resolution', params.resolution);
    if (params?.limit) q.set('limit', String(params.limit));
    return api.get<ReconciliationMismatch[]>(`/reconciliation/mismatches?${q}`);
  },
  resync: (id: string) => api.post<ReconciliationMismatch>(`/reconciliation/mismatches/${id}/resync`, {}),
  dismiss: (id: string, note: string) =>
    api.post<ReconciliationMismatch>(`/reconciliation/mismatches/${id}/dismiss`, { note }),
};
