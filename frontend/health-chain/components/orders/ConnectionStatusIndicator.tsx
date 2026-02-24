"use client";
import React from 'react';
import { ConnectionStatus } from '@/lib/utils/websocket-client';

interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
}

// Keep the Record generic on one line or ensure the < is immediately after Record
const config: Record<ConnectionStatus, { dotColor: string; bannerColor: string; label: string; show: boolean }> = {
const config: Record<
  ConnectionStatus,
  { dotColor: string; bannerColor: string; label: string; show: boolean }
> = {
  connected: {
    dotColor: 'bg-green-500',
    bannerColor: '',
    label: 'Live',
    show: false,
  },
  reconnecting: {
    dotColor: 'bg-yellow-400 animate-pulse',
    bannerColor: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    label: 'Reconnecting — showing last known data',
    show: true,
  },
  disconnected: {
    dotColor: 'bg-red-500',
    bannerColor: 'bg-red-50 border-red-200 text-red-800',
    label: 'Disconnected — real-time updates unavailable',
    show: true,
  },
};

export const ConnectionStatusIndicator: React.FC<ConnectionStatusIndicatorProps> = ({ status }) => {
  const { dotColor, bannerColor, label, show } = config[status];

  if (!show) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-500 select-none">
        <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
        <span>Live</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${bannerColor}`} role="status" aria-live="polite">
      <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
      <span>{label}</span>
    </div>
  );
};