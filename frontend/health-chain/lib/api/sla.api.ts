import { api } from './http-client';
import type { BreachSummary, SlaBreachQuery, SlaMetrics } from '@/lib/types/sla';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

function toQuery(params: SlaBreachQuery): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && q.set(k, v));
  return q.toString();
}

export async function fetchOrderSla(orderId: string): Promise<SlaMetrics> {
  return api.get<SlaMetrics>(`/${PREFIX}/orders/${orderId}/sla`);
}

export async function fetchBreaches(params: SlaBreachQuery = {}) {
  return api.get(`/${PREFIX}/sla/breaches?${toQuery(params)}`);
}

export async function fetchBreachSummary(
  dimension: 'by-hospital' | 'by-blood-bank' | 'by-rider' | 'by-urgency',
  params: SlaBreachQuery = {},
): Promise<BreachSummary[]> {
  return api.get<BreachSummary[]>(`/${PREFIX}/sla/reports/${dimension}?${toQuery(params)}`);
}
