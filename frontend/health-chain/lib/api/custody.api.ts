import { api } from './http-client';
import type { CustodyHandoff } from '../types/custody';

export const custodyApi = {
  getUnitTimeline: (bloodUnitId: string) =>
    api.get<CustodyHandoff[]>(`/custody/units/${bloodUnitId}/timeline`),
  getOrderTimeline: (orderId: string) =>
    api.get<CustodyHandoff[]>(`/custody/orders/${orderId}/timeline`),
};
