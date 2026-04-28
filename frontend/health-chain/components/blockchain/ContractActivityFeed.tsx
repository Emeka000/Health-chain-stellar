"use client";
import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { fetchContractEvents, fetchIndexerCursors } from "@/lib/api/contract-events.api";
import type { ContractDomain, ContractEvent, ContractEventsPage, IndexerCursor } from "@/lib/types/contract-events";

const DOMAIN_COLORS: Record<ContractDomain, string> = {
  identity: "bg-blue-100 text-blue-700",
  request: "bg-purple-100 text-purple-700",
  inventory: "bg-green-100 text-green-700",
  delivery: "bg-orange-100 text-orange-700",
  payment: "bg-emerald-100 text-emerald-700",
};

const ALL_DOMAINS: Array<ContractDomain | "all"> = [
  "all", "identity", "request", "inventory", "delivery", "payment",
];

function EventRow({ event }: { event: ContractEvent }) {
  const colorClass = DOMAIN_COLORS[event.domain] ?? "bg-gray-100 text-gray-700";
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition">
      <td className="py-3 px-4 text-xs text-gray-500 font-mono">{event.ledgerSequence}</td>
      <td className="py-3 px-4">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${colorClass}`}>
          {event.domain}
        </span>
      </td>
      <td className="py-3 px-4 text-sm text-gray-800 font-medium">{event.eventType}</td>
      <td className="py-3 px-4 text-xs text-gray-500 font-mono truncate max-w-[120px]">
        {event.txHash ? `${event.txHash.slice(0, 12)}…` : "—"}
      </td>
      <td className="py-3 px-4 text-xs text-gray-500">
        {event.entityRef ?? "—"}
      </td>
      <td className="py-3 px-4 text-xs text-gray-400">
        {new Date(event.indexedAt).toLocaleString()}
      </td>
    </tr>
  );
}

export default function ContractActivityFeed() {
  const [page, setPage] = useState(1);
  const [domain, setDomain] = useState<ContractDomain | "all">("all");
  const [result, setResult] = useState<ContractEventsPage | null>(null);
  const [cursors, setCursors] = useState<IndexerCursor[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eventsPage, cursorList] = await Promise.all([
        fetchContractEvents({ domain: domain === "all" ? undefined : domain, page, pageSize: 20 }),
        fetchIndexerCursors(),
      ]);
      setResult(eventsPage);
      setCursors(cursorList);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [domain, page]);

  useEffect(() => { void load(); }, [load]);

  const handleDomainChange = (d: ContractDomain | "all") => {
    setDomain(d);
    setPage(1);
  };

  return (
    <section aria-label="Contract activity feed" className="flex flex-col gap-4 font-poppins">
      {/* Cursor badges */}
      {cursors.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Indexer cursor positions">
          {cursors.map((c) => (
            <span key={c.domain} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
              {c.domain}: ledger {c.lastLedger}
            </span>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 flex-wrap">
          {ALL_DOMAINS.map((d) => (
            <button
              key={d}
              onClick={() => handleDomainChange(d)}
              className={`text-xs px-3 py-1.5 rounded-full border transition capitalize ${
                domain === d
                  ? "bg-black text-white border-black"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
              aria-pressed={domain === d}
            >
              {d}
            </button>
          ))}
        </div>
        <button
          onClick={() => void load()}
          className="p-1.5 rounded-lg border hover:bg-gray-50 transition"
          aria-label="Refresh contract events"
        >
          <RefreshCw className="w-4 h-4 text-gray-500" aria-hidden="true" />
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-left" role="table" aria-label="Contract events">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <th className="py-3 px-4 font-semibold">Ledger</th>
              <th className="py-3 px-4 font-semibold">Domain</th>
              <th className="py-3 px-4 font-semibold">Event Type</th>
              <th className="py-3 px-4 font-semibold">Tx Hash</th>
              <th className="py-3 px-4 font-semibold">Entity Ref</th>
              <th className="py-3 px-4 font-semibold">Indexed At</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : !result || result.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-gray-400">
                  No contract events indexed yet.
                </td>
              </tr>
            ) : (
              result.data.map((event) => <EventRow key={event.id} event={event} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {result && result.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            Page {result.page} of {result.totalPages} ({result.total} events)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border disabled:opacity-40 hover:bg-gray-50 transition"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(result.totalPages, p + 1))}
              disabled={page === result.totalPages}
              className="px-3 py-1.5 rounded-lg border disabled:opacity-40 hover:bg-gray-50 transition"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
