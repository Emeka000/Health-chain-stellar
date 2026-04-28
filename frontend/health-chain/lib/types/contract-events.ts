export type ContractDomain = 'identity' | 'request' | 'inventory' | 'delivery' | 'payment';

export interface ContractEvent {
  id: string;
  domain: ContractDomain;
  eventType: string;
  contractRef: string | null;
  ledgerSequence: number;
  txHash: string | null;
  payload: Record<string, unknown>;
  entityRef: string | null;
  indexedAt: string;
}

export interface IndexerCursor {
  id: string;
  domain: string;
  lastLedger: number;
  updatedAt: string;
}

export interface ContractEventsPage {
  data: ContractEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
