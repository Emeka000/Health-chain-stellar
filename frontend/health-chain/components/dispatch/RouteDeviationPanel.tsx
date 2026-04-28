"use client";
import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { useRouteDeviations } from "@/lib/hooks/useRouteDeviations";
import { useAuthStore } from "@/lib/stores/auth.store";
import type { RouteDeviationIncident } from "@/lib/types/route-deviation";

import DeviationIncidentCard from "./DeviationIncidentCard";

const SEVERITY_ORDER: Record<string, number> = { severe: 0, moderate: 1, minor: 2 };

export default function RouteDeviationPanel() {
  const { incidents, loading, connected, acknowledge, resolve, refresh } =
    useRouteDeviations();
  const { user } = useAuthStore();
  const [filter, setFilter] = useState<"all" | "severe" | "moderate" | "minor">("all");
  const prevCountRef = useRef(0);
  const [newAlert, setNewAlert] = useState(false);

  // Flash banner when new incidents arrive
  useEffect(() => {
    if (incidents.length > prevCountRef.current) {
      setNewAlert(true);
      const t = setTimeout(() => setNewAlert(false), 4000);
      prevCountRef.current = incidents.length;
      return () => clearTimeout(t);
    }
    prevCountRef.current = incidents.length;
  }, [incidents.length]);

  const filtered: RouteDeviationIncident[] = incidents
    .filter((i) => filter === "all" || i.severity === filter)
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));

  const handleAcknowledge = async (id: string) => {
    await acknowledge(id, user?.id ?? "operator");
  };

  return (
    <section aria-label="Route deviation alerts" className="flex flex-col h-full gap-4 font-poppins">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" aria-hidden="true" />
          <h2 className="text-base font-bold text-black">Route Deviations</h2>
          {incidents.length > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {incidents.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${
              connected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
            }`}
            aria-live="polite"
          >
            {connected ? "● Live" : "○ Disconnected"}
          </span>

          <select
            className="text-sm border rounded-lg px-3 py-1.5"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            aria-label="Filter by severity"
          >
            <option value="all">All severities</option>
            <option value="severe">Severe</option>
            <option value="moderate">Moderate</option>
            <option value="minor">Minor</option>
          </select>

          <button
            onClick={refresh}
            className="p-1.5 rounded-lg border hover:bg-gray-50 transition"
            aria-label="Refresh deviation incidents"
          >
            <RefreshCw className="w-4 h-4 text-gray-500" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* New alert banner */}
      {newAlert && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-red-500 text-white text-sm font-medium px-4 py-2 rounded-xl animate-pulse"
        >
          ⚠ New route deviation detected!
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          Loading incidents…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 text-gray-400">
          <AlertTriangle className="w-8 h-8 opacity-30" aria-hidden="true" />
          <p className="text-sm">No {filter !== "all" ? filter : "open"} deviation incidents</p>
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto space-y-4 pr-1"
          role="list"
          aria-label="Deviation incident list"
        >
          {filtered.map((incident) => (
            <div key={incident.id} role="listitem">
              <DeviationIncidentCard
                incident={incident}
                onAcknowledge={handleAcknowledge}
                onResolve={resolve}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
