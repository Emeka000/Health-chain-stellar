"use client";

import React, { useState } from "react";
import { useAnomalies, useReviewAnomaly } from "@/lib/hooks/useAnomalies";
import type {
  AnomalyIncident,
  AnomalyQueryParams,
  AnomalyStatus,
  AnomalySeverity,
  AnomalyType,
} from "@/lib/types/anomaly";

// ─── Severity badge ───────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<AnomalySeverity, string> = {
  HIGH: "bg-red-100 text-red-700 border border-red-300",
  MEDIUM: "bg-yellow-100 text-yellow-700 border border-yellow-300",
  LOW: "bg-gray-100 text-gray-600 border border-gray-300",
};

const STATUS_STYLES: Record<AnomalyStatus, string> = {
  OPEN: "bg-red-50 text-red-600",
  INVESTIGATING: "bg-blue-50 text-blue-600",
  DISMISSED: "bg-gray-100 text-gray-500",
  RESOLVED: "bg-green-50 text-green-600",
};

const TYPE_LABELS: Record<AnomalyType, string> = {
  DUPLICATE_EMERGENCY_REQUEST: "Duplicate Emergency Request",
  RIDER_ROUTE_DEVIATION: "Rider Cancellation Anomaly",
  REPEATED_ESCROW_DISPUTE: "Repeated Escrow Dispute",
  SUDDEN_STOCK_SWING: "Sudden Stock Swing",
};

// ─── Review Modal ─────────────────────────────────────────────────────────────

function ReviewModal({
  incident,
  onClose,
}: {
  incident: AnomalyIncident;
  onClose: () => void;
}) {
  const { mutate, isPending } = useReviewAnomaly();
  const [status, setStatus] = useState<AnomalyStatus>(incident.status);
  const [notes, setNotes] = useState(incident.reviewNotes ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutate({ id: incident.id, payload: { status, reviewNotes: notes } }, { onSuccess: onClose });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
        <h2 className="font-manrope font-bold text-xl text-brand-black">
          Review Anomaly
        </h2>

        <div className="text-sm text-gray-600 space-y-1">
          <p>
            <span className="font-semibold">Type:</span>{" "}
            {TYPE_LABELS[incident.type]}
          </p>
          <p>
            <span className="font-semibold">Description:</span>{" "}
            {incident.description}
          </p>
          {incident.hospitalId && (
            <p>
              <span className="font-semibold">Hospital:</span>{" "}
              {incident.hospitalId}
            </p>
          )}
          {incident.riderId && (
            <p>
              <span className="font-semibold">Rider:</span> {incident.riderId}
            </p>
          )}
          {incident.orderId && (
            <p>
              <span className="font-semibold">Order:</span> {incident.orderId}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Update Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as AnomalyStatus)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-black"
            >
              <option value="OPEN">Open</option>
              <option value="INVESTIGATING">Investigating</option>
              <option value="DISMISSED">Dismissed</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Review Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add investigation notes..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-black resize-none"
            />
          </div>

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 text-sm rounded-lg bg-brand-black text-white hover:brightness-110 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnomalyQueuePage() {
  const [filters, setFilters] = useState<AnomalyQueryParams>({
    status: "OPEN",
    page: 1,
    pageSize: 25,
  });
  const [selected, setSelected] = useState<AnomalyIncident | null>(null);

  const { data, isLoading, isError } = useAnomalies(filters);

  function setFilter<K extends keyof AnomalyQueryParams>(
    key: K,
    value: AnomalyQueryParams[K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  }

  return (
    <div className="p-6 lg:p-10 space-y-8 bg-white min-h-screen font-roboto">
      {selected && (
        <ReviewModal incident={selected} onClose={() => setSelected(null)} />
      )}

      <div className="border-b border-gray-100 pb-6">
        <h1 className="text-[32px] font-manrope font-bold text-brand-black">
          Anomaly Queue
        </h1>
        <p className="text-gray-500 mt-1">
          Review and investigate suspicious operational patterns.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {(["OPEN", "INVESTIGATING", "DISMISSED", "RESOLVED", undefined] as const).map(
          (s) => (
            <button
              key={s ?? "ALL"}
              onClick={() => setFilter("status", s)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold border-2 transition-all ${
                filters.status === s
                  ? "bg-brand-black text-white border-brand-black"
                  : "bg-white text-gray-600 border-gray-300 hover:border-brand-black"
              }`}
            >
              {s ?? "All"}
            </button>
          ),
        )}

        <select
          value={filters.severity ?? ""}
          onChange={(e) =>
            setFilter(
              "severity",
              (e.target.value as AnomalySeverity) || undefined,
            )
          }
          className="ml-auto border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        >
          <option value="">All Severities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>

        <select
          value={filters.type ?? ""}
          onChange={(e) =>
            setFilter("type", (e.target.value as AnomalyType) || undefined)
          }
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        >
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-gray-400 text-sm">Loading anomalies…</p>
      ) : isError ? (
        <p className="text-red-500 text-sm">Failed to load anomalies.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-left">Severity</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Detected</th>
                  <th className="px-4 py-3 text-left">Links</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.data.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-gray-400"
                    >
                      No anomalies found.
                    </td>
                  </tr>
                )}
                {data?.data.map((incident) => (
                  <tr key={incident.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">
                      {TYPE_LABELS[incident.type]}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                      {incident.description}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-bold ${SEVERITY_STYLES[incident.severity]}`}
                      >
                        {incident.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[incident.status]}`}
                      >
                        {incident.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {new Date(incident.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 space-x-2">
                      {incident.hospitalId && (
                        <span title="Hospital">🏥 {incident.hospitalId.slice(0, 8)}</span>
                      )}
                      {incident.riderId && (
                        <span title="Rider">🛵 {incident.riderId.slice(0, 8)}</span>
                      )}
                      {incident.orderId && (
                        <span title="Order">📦 {incident.orderId.slice(0, 8)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelected(incident)}
                        className="px-3 py-1 text-xs font-semibold rounded-lg border-2 border-brand-black hover:bg-brand-black hover:text-white transition"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>
                {data.pagination.totalCount} anomalies · Page{" "}
                {data.pagination.currentPage} of {data.pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={filters.page === 1}
                  onClick={() => setFilter("page", (filters.page ?? 1) - 1)}
                  className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                >
                  Prev
                </button>
                <button
                  disabled={filters.page === data.pagination.totalPages}
                  onClick={() => setFilter("page", (filters.page ?? 1) + 1)}
                  className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
