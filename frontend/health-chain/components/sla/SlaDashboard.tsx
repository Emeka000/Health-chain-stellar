"use client";

import React, { useState } from "react";
import { AlertTriangle, CheckCircle, Clock } from "lucide-react";
import type { BreachSummary, SlaBreachQuery, SlaStage } from "@/lib/types/sla";
import { useSlaBreachSummary } from "@/lib/hooks/useSla";

const STAGES: SlaStage[] = ["triage", "matching", "dispatch_acceptance", "pickup", "delivery"];
const URGENCY_TIERS = ["CRITICAL", "URGENT", "STANDARD"];

type Dimension = "by-hospital" | "by-blood-bank" | "by-rider" | "by-urgency";

const DIMENSION_LABELS: Record<Dimension, string> = {
  "by-hospital": "Hospital",
  "by-blood-bank": "Blood Bank",
  "by-rider": "Rider",
  "by-urgency": "Urgency Tier",
};

function fmtSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function BreachRateBadge({ rate }: { rate: number }) {
  const color = rate === 0 ? "text-green-600 bg-green-50" : rate < 20 ? "text-yellow-700 bg-yellow-50" : "text-red-700 bg-red-50";
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>{rate}%</span>;
}

function SummaryTable({ data }: { data: BreachSummary[] }) {
  if (!data.length) return <p className="text-sm text-gray-400 py-4 text-center">No data</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
            <th className="pb-2 pr-4 font-medium">Partner</th>
            <th className="pb-2 pr-4 font-medium text-right">Orders</th>
            <th className="pb-2 pr-4 font-medium text-right">Breaches</th>
            <th className="pb-2 pr-4 font-medium text-right">Breach Rate</th>
            <th className="pb-2 font-medium text-right">Avg Elapsed</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.value} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-2 pr-4 font-medium text-gray-800 truncate max-w-[160px]">{row.value}</td>
              <td className="py-2 pr-4 text-right text-gray-600">{row.totalOrders}</td>
              <td className="py-2 pr-4 text-right text-gray-600">{row.breachedOrders}</td>
              <td className="py-2 pr-4 text-right"><BreachRateBadge rate={row.breachRate} /></td>
              <td className="py-2 text-right text-gray-600">{fmtSeconds(row.avgElapsedSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SlaDashboard() {
  const [dimension, setDimension] = useState<Dimension>("by-hospital");
  const [filters, setFilters] = useState<SlaBreachQuery>({});

  const { data = [], isLoading } = useSlaBreachSummary(dimension, filters);

  const totalOrders = data.reduce((s, r) => s + r.totalOrders, 0);
  const totalBreaches = data.reduce((s, r) => s + r.breachedOrders, 0);
  const overallRate = totalOrders > 0 ? Math.round((totalBreaches / totalOrders) * 10000) / 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">SLA Tracking</h2>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-500">Total Orders</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{totalOrders}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-xs text-gray-500">Breaches</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{totalBreaches}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-xs text-gray-500">Breach Rate</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{overallRate}%</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-wrap gap-3">
        <select
          value={filters.urgencyTier ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, urgencyTier: e.target.value || undefined }))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700"
        >
          <option value="">All Urgency Tiers</option>
          {URGENCY_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <select
          value={filters.stage ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, stage: (e.target.value as SlaStage) || undefined }))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700"
        >
          <option value="">All Stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>

        <input
          type="date"
          value={filters.startDate ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value || undefined }))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700"
        />
        <input
          type="date"
          value={filters.endDate ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value || undefined }))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700"
        />
      </div>

      {/* Dimension tabs + table */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex gap-2 mb-4 flex-wrap">
          {(Object.keys(DIMENSION_LABELS) as Dimension[]).map((d) => (
            <button
              key={d}
              onClick={() => setDimension(d)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                dimension === d
                  ? "bg-[#D32F2F] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {DIMENSION_LABELS[d]}
            </button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
        ) : (
          <SummaryTable data={data} />
        )}
      </div>
    </div>
  );
}
