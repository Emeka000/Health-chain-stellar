'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { fetchOpenEscalations, acknowledgeEscalation } from '../api/escalation.api';
import type { Escalation } from '../types/escalation';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3000';

export function useEscalations() {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  const { data: escalations = [], isLoading } = useQuery({
    queryKey: ['escalations', 'open'],
    queryFn: fetchOpenEscalations,
    refetchInterval: 30_000,
  });

  const { mutate: acknowledge } = useMutation({
    mutationFn: acknowledgeEscalation,
    onSuccess: (updated) => {
      queryClient.setQueryData<Escalation[]>(['escalations', 'open'], (prev = []) =>
        prev.filter((e) => e.id !== updated.id),
      );
    },
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['escalations', 'open'] });
  }, [queryClient]);

  useEffect(() => {
    const socket = io(`${WS_URL}/escalations`, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('escalation.triggered', (event: { requestId: string }) => {
      // New escalation arrived – refetch to get full record
      invalidate();
    });

    socket.on('escalation.acknowledged', (event: { escalationId: string }) => {
      queryClient.setQueryData<Escalation[]>(['escalations', 'open'], (prev = []) =>
        prev.filter((e) => e.id !== event.escalationId),
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [invalidate, queryClient]);

  return { escalations, isLoading, acknowledge };
}
