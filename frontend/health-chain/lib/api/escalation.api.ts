import { api } from './http-client';
import type { Escalation } from '../types/escalation';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export async function fetchOpenEscalations(): Promise<Escalation[]> {
  return api.get<Escalation[]>(`/${PREFIX}/escalations/open`);
}

export async function acknowledgeEscalation(id: string): Promise<Escalation> {
  return api.post<Escalation>(`/${PREFIX}/escalations/${id}/acknowledge`, {});
}
