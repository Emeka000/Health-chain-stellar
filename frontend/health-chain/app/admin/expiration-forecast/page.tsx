"use client";

import React, { useState } from "react";
import {
  useExpirationForecast,
  useRebalancingRecommendations,
} from "@/lib/hooks/useExpirationForecast";
import type {
  ExpirationWindow,
  TransferRecommendation,
  DemandUrgency,
} from "@/lib/types/expiration-forecast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WINDOW_COLORS: Record<string, string> = {
  "< 24h": "border-red-400 bg-red-50",
  "24–48h": "border-yellow-400 bg-yellow-50",
  "48–72h": "border-blue-300 bg-blue-50",
};

const URGENCY_BADGE: Record<DemandUrgency, string> = {
  CRITICAL: "bg-red-100 text-red-700",
  URGENT: "bg-orange-100 text-orange-700",
  ROUTINE: "bg-blue-100 text-blue-600",
  SCHEDULED: "bg-gray-100 text-gray-500",
};

// ─── Expiration Windows ───────────────────────────────────────────────────────

function ExpirationCard({ window: w }: { window: ExpirationWindow }) {
  const [expanded, setExpanded] = useState(false);
  const color = WINDOW_COLORS[w.windowLabel] ?? "border-gray-300 bg-gray-50";

  // Group by blood type for summary
  const byType = w.units.reduce<Record<string, number>>((acc, u) => {
    acc[u.bloodType] = (acc[u.bloodType] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className={`rounded-xl border-2 p-5 space-y-3 ${color}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-manrope font-bold text-lg text-brand-black">
          {w.windowLabel}
        </h3>
        <span className="text-sm text-gray-500">
          {w.units.length} unit{w.units.length !== 1 ? "s" : ""} ·{" "}
          {(w.totalVolumeMl / 1000).toFixed(1)} L
        </span>
      </div>

      {/* Blood type summary pills */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(byType).map(([bt, count]) => (
          <span
            key={bt}
            className="px-2 py-0.5 rounded-full bg-white border border-gray-300 text-xs font-bold text-brand-black"
          >
            {bt} × {count}
          </span>
        ))}
        {w.units.length === 0 && (
          <span className="text-sm text-gray-400">No units expiring</span>
        )}
      </div>

      {w.units.length > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-blue-600 hover:underline"
        >
          {expanded ? "Hide" : "Show"} unit details
        </button>
      )}

      {expanded && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Vol (mL)</th>
                <th className="px-3 py-2 text-left">Expires</th>
                <th className="px-3 py-2 text-left">Bank</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {w.units.map((u) => (
                <tr key={u.unitId}>
                  <td className="px-3 py-1.5 font-mono">{u.unitCode}</td>
                  <td className="px-3 py-1.5 font-bold">{u.bloodType}</td>
                  <td className="px-3 py-1.5">{u.volumeMl}</td>
                  <td className="px-3 py-1.5 text-red-600">
                    {u.hoursRemaining.toFixed(1)}h
                  </td>
                  <td className="px-3 py-1.5 text-gray-500 truncate max-w-[120px]">
                    {u.organizationName ?? u.organizationId.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Transfer Recommendations ─────────────────────────────────────────────────

function RecommendationRow({ rec }: { rec: TransferRecommendation }) {
  return (
    <tr className="hover:bg-gray-50 transition">
      <td className="px-4 py-3">
        <span className="font-bold text-brand-black">{rec.bloodType}</span>
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        {rec.fromBankName ?? rec.fromBankId.slice(0, 8)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        {rec.toBankName ?? rec.toBankId.slice(0, 8)}
      </td>
      <td className="px-4 py-3 text-center font-semibold">
        {rec.unitsToTransfer}
      </td>
      <td className="px-4 py-3 text-sm text-red-500">
        {rec.expiringWithinHours.toFixed(1)}h
      </td>
      <td className="px-4 py-3 text-sm text-gray-500">
        {rec.distanceKm !== null ? `${rec.distanceKm} km` : "—"}
      </td>
      <td className="px-4 py-3">
        {rec.demandUrgency ? (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-bold ${URGENCY_BADGE[rec.demandUrgency]}`}
          >
            {rec.demandUrgency}
          </span>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm font-bold text-brand-black">
        {rec.urgencyScore}
      </td>
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExpirationForecastPage() {
  const [horizon, setHorizon] = useState(72);
  const { data: windows, isLoading: loadingForecast } = useExpirationForecast(horizon);
  const { data: recommendations, isLoading: loadingRec } = useRebalancingRecommendations();

  const totalExpiring = windows?.reduce((s, w) => s + w.units.length, 0) ?? 0;

  return (
    <div className="p-6 lg:p-10 space-y-10 bg-white min-h-screen font-roboto">
      {/* Header */}
      <div className="border-b border-gray-100 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-manrope font-bold text-brand-black">
            Expiration Forecast
          </h1>
          <p className="text-gray-500 mt-1">
            Upcoming expirations and inter-bank rebalancing recommendations.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">Horizon:</span>
          {[24, 48, 72].map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold border-2 transition ${
                horizon === h
                  ? "bg-brand-black text-white border-brand-black"
                  : "bg-white text-gray-600 border-gray-300 hover:border-brand-black"
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {/* Summary stat */}
      {!loadingForecast && (
        <div className="flex gap-6">
          <div className="rounded-xl border-2 border-brand-black px-6 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <p className="text-3xl font-manrope font-bold text-brand-black">{totalExpiring}</p>
            <p className="text-sm text-gray-500 mt-1">Units expiring within {horizon}h</p>
          </div>
          <div className="rounded-xl border-2 border-yellow-400 px-6 py-4">
            <p className="text-3xl font-manrope font-bold text-brand-black">
              {recommendations?.length ?? "—"}
            </p>
            <p className="text-sm text-gray-500 mt-1">Transfer recommendations</p>
          </div>
        </div>
      )}

      {/* Expiration windows */}
      <section className="space-y-4">
        <h2 className="font-manrope font-bold text-xl text-brand-black">
          Expiration Windows
        </h2>
        {loadingForecast ? (
          <p className="text-gray-400 text-sm">Loading forecast…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {windows?.map((w) => (
              <ExpirationCard key={w.windowLabel} window={w} />
            ))}
          </div>
        )}
      </section>

      {/* Rebalancing recommendations */}
      <section className="space-y-4">
        <h2 className="font-manrope font-bold text-xl text-brand-black">
          Rebalancing Recommendations
        </h2>
        <p className="text-sm text-gray-500">
          Ranked by urgency score (demand urgency + freshness − distance penalty).
        </p>
        {loadingRec ? (
          <p className="text-gray-400 text-sm">Loading recommendations…</p>
        ) : !recommendations?.length ? (
          <p className="text-gray-400 text-sm">No rebalancing needed right now.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Blood Type</th>
                  <th className="px-4 py-3 text-left">From Bank</th>
                  <th className="px-4 py-3 text-left">To Bank</th>
                  <th className="px-4 py-3 text-center">Units</th>
                  <th className="px-4 py-3 text-left">Expires In</th>
                  <th className="px-4 py-3 text-left">Distance</th>
                  <th className="px-4 py-3 text-left">Demand</th>
                  <th className="px-4 py-3 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recommendations.map((rec, i) => (
                  <RecommendationRow key={i} rec={rec} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
