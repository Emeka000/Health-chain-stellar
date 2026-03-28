import { api } from './http-client';
import type {
  AnomaliesResponse,
  AnomalyIncident,
  AnomalyQueryParams,
  ReviewAnomalyPayload,
} from '@/lib/types/anomaly';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export async function fetchAnomalies(
  params: AnomalyQueryParams,
): Promise<AnomaliesResponse> {
  const q = new URLSearchParams();
  if (params.type) q.set('type', params.type);
  if (params.severity) q.set('severity', params.severity);
  if (params.status) q.set('status', params.status);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  return api.get<AnomaliesResponse>(`/${PREFIX}/anomalies?${q.toString()}`);
}

export async function reviewAnomaly(
  id: string,
  payload: ReviewAnomalyPayload,
): Promise<AnomalyIncident> {
  return api.patch<AnomalyIncident>(`/${PREFIX}/anomalies/${id}/review`, payload);
}
