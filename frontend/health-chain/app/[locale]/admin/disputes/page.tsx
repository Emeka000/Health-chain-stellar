"use client";

import React, { useEffect, useState } from "react";
import { DisputeConsole } from "@/components/disputes/DisputeConsole";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function DisputesPage() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch(`${API}/disputes`)
      .then((r) => r.json())
      .then(setDisputes)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleResolve = async (id: string, notes: string) => {
    await fetch(`${API}/disputes/${id}/resolve`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutionNotes: notes }),
    });
    load();
  };

  return (
    <div className="p-6 lg:p-10 space-y-6 bg-white min-h-screen">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dispute Resolution</h1>
        <p className="text-gray-500 mt-1">Investigate and resolve contested deliveries and payments.</p>
      </div>
      {loading ? (
        <LoadingSpinner />
      ) : (
        <DisputeConsole disputes={disputes} onResolve={handleResolve} />
      )}
    </div>
  );
}
