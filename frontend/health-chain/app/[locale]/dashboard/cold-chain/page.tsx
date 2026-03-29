"use client";

import React, { useEffect, useState } from "react";
import { TemperatureTimeline } from "@/components/cold-chain/TemperatureTimeline";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Search } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function ColdChainPage() {
  const [deliveryId, setDeliveryId] = useState("");
  const [query, setQuery] = useState("");
  const [samples, setSamples] = useState<any[]>([]);
  const [compliance, setCompliance] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const [timelineRes, complianceRes] = await Promise.all([
        fetch(`${API}/cold-chain/deliveries/${encodeURIComponent(query.trim())}/timeline`),
        fetch(`${API}/cold-chain/deliveries/${encodeURIComponent(query.trim())}/compliance`),
      ]);
      setSamples(timelineRes.ok ? await timelineRes.json() : []);
      setCompliance(complianceRes.ok ? await complianceRes.json() : null);
      setDeliveryId(query.trim());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 lg:p-10 space-y-6 bg-white min-h-screen">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Cold-Chain Telemetry</h1>
        <p className="text-gray-500 mt-1">View temperature logs and compliance status for deliveries.</p>
      </div>

      <div className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Enter delivery ID…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <button
          onClick={search}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          Load
        </button>
      </div>

      {loading && <LoadingSpinner />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {deliveryId && !loading && (
        <div className="max-w-2xl">
          <TemperatureTimeline samples={samples} compliance={compliance} />
        </div>
      )}
    </div>
  );
}
