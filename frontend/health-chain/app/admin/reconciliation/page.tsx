"use client";

import React, { useState } from "react";
import {
  useReconciliationRuns,
  useReconciliationMismatches,
  useTriggerRun,
  useResync,
  useDismiss,
} from "@/lib/hooks/useReconciliation";
import type { ReconciliationMismatch } from "@/lib/types/reconciliation";

const SEVERITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-gray-100 text-gray-600",
};

const RESOLUTION_COLORS: Record<string, string> = {
  pending: "bg-orange-100 text-orange-700",
  resynced: "bg-green-100 text-green-700",
  dismissed: "bg-gray-100 text-gray-500",
  manual: "bg-blue-100 text-blue-700",
};

export default function ReconciliationPage() {
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [resolutionFilter, setResolutionFilter] = useState<string>("");
  const [dismissNote, setDismissNote] = useState<Record<string, string>>({});

  const { data: runs, isLoading: runsLoading } = useReconciliationRuns();
  const { data: mismatches, isLoading: mismatchesLoading } =
    useReconciliationMismatches({ runId: selectedRunId, resolution: resolutionFilter || undefined });

  const triggerRun = useTriggerRun();
  const resync = useResync();
  const dismiss = useDismiss();

  return (
    <div className="p-6 lg:p-10 space-y-8 bg-white min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Settlement Reconciliation</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Compare on-chain payment state with database records and remediate divergence.
          </p>
        </div>
        <button
          onClick={() => triggerRun.mutate()}
          disabled={triggerRun.isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {triggerRun.isPending ? "Running…" : "Run Reconciliation"}
        </button>
      </div>

      {/* Runs table */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Reconciliation Runs</h2>
        {runsLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["ID", "Status", "Checked", "Mismatches", "Triggered By", "Completed At"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-semibold text-gray-700">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {runs?.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id === selectedRunId ? undefined : run.id)}
                    className={`cursor-pointer hover:bg-blue-50 ${selectedRunId === run.id ? "bg-blue-50" : ""}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{run.id.slice(0, 8)}…</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        run.status === "completed" ? "bg-green-100 text-green-700" :
                        run.status === "failed" ? "bg-red-100 text-red-700" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>{run.status}</span>
                    </td>
                    <td className="px-4 py-3">{run.totalChecked}</td>
                    <td className="px-4 py-3 font-semibold">{run.mismatchCount}</td>
                    <td className="px-4 py-3 text-gray-500">{run.triggeredBy ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {run.completedAt ? new Date(run.completedAt).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Mismatches table */}
      <section>
        <div className="flex items-center gap-4 mb-3">
          <h2 className="text-lg font-semibold text-gray-800">
            Mismatches {selectedRunId && <span className="text-sm font-normal text-gray-500">(filtered by run)</span>}
          </h2>
          <select
            value={resolutionFilter}
            onChange={(e) => setResolutionFilter(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm"
          >
            <option value="">All resolutions</option>
            <option value="pending">Pending</option>
            <option value="resynced">Resynced</option>
            <option value="dismissed">Dismissed</option>
            <option value="manual">Manual</option>
          </select>
        </div>

        {mismatchesLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : !mismatches?.length ? (
          <p className="text-sm text-gray-400">No mismatches found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["Reference", "Type", "Severity", "On-Chain", "Off-Chain", "Resolution", "Actions"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-semibold text-gray-700">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mismatches.map((m: ReconciliationMismatch) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-gray-500">{m.referenceId.slice(0, 8)}…</div>
                      <div className="text-xs text-gray-400">{m.referenceType}</div>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">{m.type.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[m.severity]}`}>
                        {m.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">
                      {m.onChainValue ? JSON.stringify(m.onChainValue) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">
                      {m.offChainValue ? JSON.stringify(m.offChainValue) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RESOLUTION_COLORS[m.resolution]}`}>
                        {m.resolution}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {m.resolution === "pending" && (
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => resync.mutate(m.id)}
                            disabled={resync.isPending}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            Resync
                          </button>
                          <div className="flex gap-1">
                            <input
                              type="text"
                              placeholder="Note…"
                              value={dismissNote[m.id] ?? ""}
                              onChange={(e) => setDismissNote((n) => ({ ...n, [m.id]: e.target.value }))}
                              className="border border-gray-300 rounded px-1 py-0.5 text-xs w-24"
                            />
                            <button
                              onClick={() => dismiss.mutate({ id: m.id, note: dismissNote[m.id] ?? "" })}
                              disabled={dismiss.isPending}
                              className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      )}
                      {m.resolution !== "pending" && (
                        <span className="text-xs text-gray-400">{m.resolutionNote ?? "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
