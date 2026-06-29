import { api } from './http-client';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export type TxStatus = 'pending' | 'confirmed' | 'failed';

export interface TxStatusResponse {
  txHash: string;
  status: TxStatus;
}

export function fetchTxStatus(txHash: string): Promise<TxStatusResponse> {
  return api.get<TxStatusResponse>(`/${PREFIX}/blockchain/status/${txHash}`);
}
