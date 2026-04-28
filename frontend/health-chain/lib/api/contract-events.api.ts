import { api } from './http-client';
import type { ContractDomain, ContractEventsPage, IndexerCursor } from '../types/contract-events';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export async function fetchContractEvents(params: {
  domain?: ContractDomain;
  eventType?: string;
  entityRef?: string;
  page?: number;
  pageSize?: number;
}): Promise<ContractEventsPage> {
  const qs = new URLSearchParams();
  if (params.domain) qs.set('domain', params.domain);
  if (params.eventType) qs.set('eventType', params.eventType);
  if (params.entityRef) qs.set('entityRef', params.entityRef);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  return api.get<ContractEventsPage>(`/${PREFIX}/contract-events?${qs.toString()}`);
}

export async function fetchIndexerCursors(): Promise<IndexerCursor[]> {
  return api.get<IndexerCursor[]>(`/${PREFIX}/contract-events/cursors`);
}
