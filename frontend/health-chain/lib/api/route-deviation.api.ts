import { api } from './http-client';
import type { RouteDeviationIncident } from '../types/route-deviation';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export async function fetchOpenDeviationIncidents(): Promise<RouteDeviationIncident[]> {
  return api.get<RouteDeviationIncident[]>(`/${PREFIX}/route-deviation/incidents`);
}

export async function fetchDeviationIncidentsByOrder(
  orderId: string,
): Promise<RouteDeviationIncident[]> {
  return api.get<RouteDeviationIncident[]>(
    `/${PREFIX}/route-deviation/incidents/order/${orderId}`,
  );
}

export async function acknowledgeDeviationIncident(
  id: string,
  userId: string,
): Promise<RouteDeviationIncident> {
  return api.patch<RouteDeviationIncident>(
    `/${PREFIX}/route-deviation/incidents/${id}/acknowledge`,
    { userId },
  );
}

export async function resolveDeviationIncident(
  id: string,
): Promise<RouteDeviationIncident> {
  return api.patch<RouteDeviationIncident>(
    `/${PREFIX}/route-deviation/incidents/${id}/resolve`,
  );
}
