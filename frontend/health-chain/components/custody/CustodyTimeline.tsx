"use client";

import React from "react";
import type { CustodyHandoff } from "@/lib/types/custody";

const ACTOR_LABELS: Record<string, string> = {
  blood_bank: "Blood Bank",
  rider: "Rider",
  hospital: "Hospital",
};

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  cancelled: "bg-red-100 text-red-700",
};

interface Props {
  handoffs: CustodyHandoff[];
  isLoading?: boolean;
}

export function CustodyTimeline({ handoffs, isLoading }: Props) {
  if (isLoading) return <p className="text-sm text-gray-500">Loading custody timeline…</p>;
  if (!handoffs.length) return <p className="text-sm text-gray-400">No custody handoffs recorded.</p>;

  return (
    <ol className="relative border-l border-gray-200 space-y-6 ml-3">
      {handoffs.map((h, i) => (
        <li key={h.id} className="ml-6">
          <span className="absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold ring-4 ring-white">
            {i + 1}
          </span>
          <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gray-800">
                {ACTOR_LABELS[h.fromActorType] ?? h.fromActorType}
                {" → "}
                {ACTOR_LABELS[h.toActorType] ?? h.toActorType}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[h.status]}`}>
                {h.status}
              </span>
            </div>
            <div className="text-xs text-gray-500 space-y-0.5">
              <div>From: <span className="font-mono">{h.fromActorId}</span></div>
              <div>To: <span className="font-mono">{h.toActorId}</span></div>
              {h.confirmedAt && (
                <div>Confirmed: {new Date(h.confirmedAt).toLocaleString()}</div>
              )}
              {h.proofReference && (
                <div>Proof: <span className="font-mono">{h.proofReference}</span></div>
              )}
              {h.contractEventId && (
                <div>Tx: <span className="font-mono text-blue-600">{h.contractEventId.slice(0, 16)}…</span></div>
              )}
              {h.latitude != null && h.longitude != null && (
                <div>Location: {h.latitude.toFixed(4)}, {h.longitude.toFixed(4)}</div>
              )}
              <div className="text-gray-400">{new Date(h.createdAt).toLocaleString()}</div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
