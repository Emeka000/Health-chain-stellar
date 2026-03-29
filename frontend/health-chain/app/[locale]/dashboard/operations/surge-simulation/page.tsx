"use client";

import React, { useState } from "react";

import {
  runSurgeSimulation,
  type SurgeSimulationResult,
} from "@/lib/api/operations.api";

export default function SurgeSimulationPage() {
  const [demand, setDemand] = useState(500);
  const [unitsPerRider, setUnitsPerRider] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SurgeSimulationResult | null>(null);

  const onRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await runSurgeSimulation({
        surgeDemandUnits: demand,
        unitsPerRider,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F8F8] font-poppins p-6 md:p-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-[26px] font-bold text-brand-black tracking-[0.03em]">
          Emergency surge simulation
        </h1>
        <p className="text-[14px] text-[#5C5B5B] mt-2 mb-8">
          Model a spike in blood-unit demand against aggregated inventory stock and
          active rider capacity (available, on delivery, or busy).
        </p>

        <div className="bg-white rounded-[14px] border border-gray-200 p-6 space-y-4 shadow-sm">
          <label className="block text-[13px] font-medium text-[#333]">
            Surge demand (units)
            <input
              type="number"
              min={1}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-[14px]"
              value={demand}
              onChange={(e) => setDemand(Number(e.target.value) || 0)}
            />
          </label>
          <label className="block text-[13px] font-medium text-[#333]">
            Units per rider (assumption)
            <input
              type="number"
              min={1}
              step={0.5}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-[14px]"
              value={unitsPerRider}
              onChange={(e) => setUnitsPerRider(Number(e.target.value) || 1)}
            />
          </label>
          <button
            type="button"
            onClick={onRun}
            disabled={loading || demand <= 0}
            className="w-full py-3 rounded-[12px] bg-[#D32F2F] text-white text-[14px] font-semibold disabled:opacity-50"
          >
            {loading ? "Running…" : "Run simulation"}
          </button>
          {error && (
            <p className="text-[13px] text-red-600" role="alert">
              {error}
            </p>
          )}
        </div>

        {result && (
          <div className="mt-8 bg-white rounded-[14px] border border-gray-200 p-6 shadow-sm space-y-3 text-[14px] text-[#333]">
            <h2 className="text-[16px] font-semibold text-brand-black">Results</h2>
            <dl className="grid grid-cols-2 gap-2 text-[13px]">
              <dt className="text-[#5C5B5B]">Stock (units)</dt>
              <dd className="font-medium">{result.baselineStockUnits}</dd>
              <dt className="text-[#5C5B5B]">Rider capacity (units)</dt>
              <dd className="font-medium">{result.riderCapacityUnits}</dd>
              <dt className="text-[#5C5B5B]">Active riders</dt>
              <dd className="font-medium">{result.activeRidersConsidered}</dd>
              <dt className="text-[#5C5B5B]">Stock covers surge?</dt>
              <dd className="font-medium">
                {result.canAbsorbWithStock ? "Yes" : "No"}
              </dd>
              <dt className="text-[#5C5B5B]">Riders cover surge?</dt>
              <dd className="font-medium">
                {result.canAbsorbWithRiders ? "Yes" : "No"}
              </dd>
            </dl>
            <p className="text-[13px] text-[#5C5B5B] pt-2 border-t border-gray-100">
              {result.summary}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
