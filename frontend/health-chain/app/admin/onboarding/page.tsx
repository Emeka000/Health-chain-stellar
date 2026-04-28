"use client";

import React, { useState } from "react";
import { useActivateOnboarding, usePendingOnboardings, useReviewOnboarding } from "@/lib/hooks/useOnboarding";
import type { PartnerOnboarding } from "@/lib/types/onboarding";

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  activated: "bg-blue-100 text-blue-700",
  draft: "bg-gray-100 text-gray-500",
};

export default function OnboardingReviewPage() {
  const { data: onboardings, isLoading } = usePendingOnboardings();
  const reviewMutation = useReviewOnboarding();
  const activateMutation = useActivateOnboarding();

  const [selected, setSelected] = useState<PartnerOnboarding | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");

  const handleReview = (decision: "approved" | "rejected") => {
    if (!selected) return;
    reviewMutation.mutate({ id: selected.id, decision, rejectionReason: rejectionReason || undefined });
    setSelected(null);
  };

  const handleActivate = () => {
    if (!selected || !walletAddress || !licenseNumber) return;
    activateMutation.mutate({ id: selected.id, walletAddress, licenseNumber });
    setSelected(null);
  };

  return (
    <div className="p-6 lg:p-10 space-y-6 bg-white min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900">Onboarding Review</h1>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["ID", "Type", "Status", "Submitted By", "Submitted At", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-semibold text-gray-700">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {onboardings?.map((o) => (
              <tr key={o.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{o.id.slice(0, 8)}…</td>
                <td className="px-4 py-3">{o.orgType.replace(/_/g, " ")}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[o.status]}`}>
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{o.submittedBy}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(o.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setSelected(o)}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Review panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Review Onboarding</h2>
            <p className="text-sm text-gray-500">ID: <span className="font-mono">{selected.id}</span></p>
            <p className="text-sm text-gray-500">Type: {selected.orgType}</p>
            <p className="text-sm text-gray-500">Status: <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[selected.status]}`}>{selected.status}</span></p>

            {/* Step data preview */}
            <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 max-h-40 overflow-y-auto">
              <pre>{JSON.stringify(selected.data, null, 2)}</pre>
            </div>

            {selected.status === "submitted" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rejection Reason (if rejecting)</label>
                  <input
                    type="text"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full"
                    placeholder="Optional"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleReview("approved")} className="flex-1 px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700">
                    Approve
                  </button>
                  <button onClick={() => handleReview("rejected")} className="flex-1 px-4 py-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700">
                    Reject
                  </button>
                </div>
              </>
            )}

            {selected.status === "approved" && (
              <>
                <div className="space-y-2">
                  <input type="text" placeholder="Wallet Address" value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full" />
                  <input type="text" placeholder="License Number" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full" />
                </div>
                <button
                  onClick={handleActivate}
                  disabled={!walletAddress || !licenseNumber || activateMutation.isPending}
                  className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {activateMutation.isPending ? "Activating…" : "Activate Organization"}
                </button>
              </>
            )}

            <button onClick={() => setSelected(null)} className="w-full px-4 py-2 border border-gray-300 text-sm rounded-md hover:bg-gray-50">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
