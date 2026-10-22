'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchTxStatus, type TxStatus } from '../api/blockchain.api';
import { useToast } from './useToast';

const POLL_INTERVAL_MS = 2000;

interface UseBlockchainTransactionReturn {
  txHash: string | null;
  status: TxStatus | null;
  submit: (action: () => Promise<{ txHash: string }>) => Promise<void>;
  reset: () => void;
}

/**
 * Standardised hook for submitting and tracking Soroban transactions.
 *
 * Usage:
 *   const { txHash, status, submit } = useBlockchainTransaction();
 *   await submit(() => api.post('/blockchain/donate', payload));
 */
export function useBlockchainTransaction(): UseBlockchainTransactionReturn {
  const [txHash, setTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<TxStatus | null>(null);
  const { showToast } = useToast();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPolling = useCallback(
    (hash: string) => {
      pollRef.current = setInterval(async () => {
        try {
          const { status: s } = await fetchTxStatus(hash);
          setStatus(s);

          if (s === 'confirmed') {
            stopPolling();
            showToast('Transaction confirmed on-chain.', 'success');
          } else if (s === 'failed') {
            stopPolling();
            showToast('Transaction failed on-chain.', 'error');
          }
        } catch {
          // keep polling — transient network error
        }
      }, POLL_INTERVAL_MS);
    },
    [showToast],
  );

  const submit = useCallback(
    async (action: () => Promise<{ txHash: string }>) => {
      stopPolling();
      setTxHash(null);
      setStatus('pending');

      try {
        const { txHash: hash } = await action();
        setTxHash(hash);
        startPolling(hash);
      } catch (err) {
        setStatus('failed');
        showToast(
          err instanceof Error ? err.message : 'Transaction submission failed.',
          'error',
        );
      }
    },
    [showToast, startPolling],
  );

  const reset = useCallback(() => {
    stopPolling();
    setTxHash(null);
    setStatus(null);
  }, []);

  // Clean up on unmount
  useEffect(() => () => stopPolling(), []);

  return { txHash, status, submit, reset };
}
