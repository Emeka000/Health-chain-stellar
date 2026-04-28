"use client";

import React, { useState } from "react";
import { useUnitCustodyTimeline, useOrderCustodyTimeline } from "@/lib/hooks/useCustody";
import { CustodyTimeline } from "@/components/custody/CustodyTimeline";

export default function CustodyPage() {
  const [mode, setMode] = useState<"unit" | "order">("order");
  const [id, setId] = useState("");
  const [submitted, setSubmitted] = useState("");

  const unitQuery = useUnitCustodyTimeline(mode === "unit" ? submitted : "");
  const orderQuery = useOrderCustodyTimeline(mode === "order" ? submitted : "");

  const { data, isLoading } = mode === "unit" ? unitQuery : orderQuery;

  return (
    <div className="p-6 lg:p-10 space-y-6 bg-white min-h-screen">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Chain-of-Custody</h1>
        <p className="text-gray-500 mt-1 text-sm">
          View every custody handoff from blood bank → rider → hospital.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex rounded-md border border-gray-300 overflow-hidden text-sm">
          {(["order", "unit"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setSubmitted(""); }}
              className={`px-4 py-2 ${mode === m ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              By {m === "order" ? "Order" : "Blood Unit"}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder={`Enter ${mode === "order" ? "order" : "blood unit"} ID…`}
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => setSubmitted(id.trim())}
          disabled={!id.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          Load
        </button>
      </div>

      {submitted && (
        <CustodyTimeline handoffs={data ?? []} isLoading={isLoading} />
      )}
    </div>
  );
}
