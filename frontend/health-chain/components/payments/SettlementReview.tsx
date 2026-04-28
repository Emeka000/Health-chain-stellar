"use client";

import React, { useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, Clock, ShieldCheck } from "lucide-react";
import type { ProofBundle, ValidationResult } from "@/lib/types/proof-bundle";
import { releaseEscrow } from "@/lib/api/proof-bundle.api";

interface Props {
  paymentId: string;
  bundles: ProofBundle[];
  onReleased?: (bundle: ProofBundle) => void;
}

const STATUS_CONFIG = {
  validated: { icon: CheckCircle, color: "text-green-600", bg: "bg-green-50", label: "Validated" },
  rejected: { icon: XCircle, color: "text-red-600", bg: "bg-red-50", label: "Rejected" },
  pending: { icon: Clock, color: "text-yellow-600", bg: "bg-yellow-50", label: "Pending" },
} as const;

function HashField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className="font-mono text-xs text-gray-700 break-all">{value}</span>
    </div>
  );
}

function BundleCard({
  bundle,
  onRelease,
}: {
  bundle: ProofBundle;
  onRelease: (id: string) => void;
}) {
  const cfg = STATUS_CONFIG[bundle.status];
  const Icon = cfg.icon;

  return (
    <div className={`rounded-xl border p-4 ${cfg.bg} border-gray-200`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-5 h-5 ${cfg.color}`} />
          <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
        </div>
        <span className="text-xs text-gray-400">
          {new Date(bundle.createdAt).toLocaleString()}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 mb-3">
        <HashField label="Delivery Hash" value={bundle.deliveryHash} />
        <HashField label="Signature Hash" value={bundle.signatureHash} />
        <HashField label="Photo Hash" value={bundle.photoHash} />
        <HashField label="Medical Hash" value={bundle.medicalHash} />
      </div>

      <div className="text-xs text-gray-500 mb-3">
        Submitted by: <span className="font-medium text-gray-700">{bundle.submittedBy}</span>
      </div>

      {bundle.rejectionReason && (
        <div className="flex items-start gap-2 bg-red-100 rounded-lg p-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{bundle.rejectionReason}</p>
        </div>
      )}

      {bundle.releasedAt && (
        <div className="flex items-center gap-2 text-xs text-green-700 font-medium">
          <ShieldCheck className="w-4 h-4" />
          Escrow released at {new Date(bundle.releasedAt).toLocaleString()}
        </div>
      )}

      {bundle.status === "validated" && !bundle.releasedAt && (
        <button
          onClick={() => onRelease(bundle.id)}
          className="mt-3 w-full py-2 rounded-lg bg-[#D32F2F] text-white text-sm font-semibold hover:bg-red-700 transition-colors"
        >
          Release Escrow
        </button>
      )}
    </div>
  );
}

export function SettlementReview({ paymentId, bundles: initialBundles, onReleased }: Props) {
  const [bundles, setBundles] = useState<ProofBundle[]>(initialBundles);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRelease = async (bundleId: string) => {
    setReleasing(bundleId);
    setError(null);
    try {
      const updated = await releaseEscrow(bundleId, "finance-ops");
      setBundles((prev) => prev.map((b) => (b.id === bundleId ? updated : b)));
      onReleased?.(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to release escrow");
    } finally {
      setReleasing(null);
    }
  };

  const validated = bundles.filter((b) => b.status === "validated");
  const rejected = bundles.filter((b) => b.status === "rejected");
  const pending = bundles.filter((b) => b.status === "pending");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Settlement Review</h2>
        <span className="text-xs text-gray-500">Payment {paymentId}</span>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Validated", count: validated.length, color: "text-green-600" },
          { label: "Rejected", count: rejected.length, color: "text-red-600" },
          { label: "Pending", count: pending.length, color: "text-yellow-600" },
        ].map(({ label, count, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
            <p className={`text-2xl font-bold ${color}`}>{count}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {bundles.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">
          No proof bundles submitted for this payment yet.
        </div>
      ) : (
        <div className={`space-y-3 ${releasing ? "opacity-60 pointer-events-none" : ""}`}>
          {bundles.map((bundle) => (
            <BundleCard key={bundle.id} bundle={bundle} onRelease={handleRelease} />
          ))}
        </div>
      )}
    </div>
  );
}
