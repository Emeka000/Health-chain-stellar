"use client";

import React, { useEffect, useState } from "react";
import { DonorEligibilityCard } from "@/components/donors/DonorEligibilityCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Search } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function DonorEligibilityPage() {
  const [donorId, setDonorId] = useState("");
  const [query, setQuery] = useState("");
  const [eligibility, setEligibility] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/donor-eligibility/${encodeURIComponent(query.trim())}`);
      if (!res.ok) throw new Error("Donor not found");
      setEligibility(await res.json());
      setDonorId(query.trim());
    } catch (e: any) {
      setError(e.message);
      setEligibility(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 lg:p-10 space-y-6 bg-white min-h-screen">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Donor Eligibility</h1>
        <p className="text-gray-500 mt-1">Check eligibility status, deferrals, and recovery windows.</p>
      </div>

      <div className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Enter donor ID…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <button
          onClick={search}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          Check
        </button>
      </div>

      {loading && <LoadingSpinner />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {eligibility && <DonorEligibilityCard eligibility={eligibility} />}
    </div>
  );
}
