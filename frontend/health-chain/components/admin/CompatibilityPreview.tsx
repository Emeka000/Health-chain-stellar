"use client";

import React, { useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, Zap } from "lucide-react";
import type {
  BloodComponent,
  BloodTypeStr,
  CompatibilityResult,
  PreviewRequest,
  Urgency,
} from "@/lib/types/compatibility";
import { previewCompatibility } from "@/lib/api/compatibility.api";

const BLOOD_TYPES: BloodTypeStr[] = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];
const COMPONENTS: BloodComponent[] = [
  "WHOLE_BLOOD",
  "RED_CELLS",
  "PLATELETS",
  "PLASMA",
  "FRESH_FROZEN_PLASMA",
  "CRYOPRECIPITATE",
];
const URGENCIES: Urgency[] = ["low", "medium", "high", "critical"];

const MATCH_CONFIG = {
  exact:        { icon: CheckCircle, color: "text-green-600",  bg: "bg-green-50",  label: "Exact Match" },
  compatible:   { icon: CheckCircle, color: "text-blue-600",   bg: "bg-blue-50",   label: "Compatible" },
  emergency:    { icon: Zap,         color: "text-orange-600", bg: "bg-orange-50", label: "Emergency Substitution" },
  incompatible: { icon: XCircle,     color: "text-red-600",    bg: "bg-red-50",    label: "Incompatible" },
} as const;

function Select<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
        ))}
      </select>
    </div>
  );
}

export function CompatibilityPreview() {
  const [form, setForm] = useState<PreviewRequest>({
    donorType: "O-",
    recipientType: "A+",
    component: "RED_CELLS",
    urgency: "high",
    allowEmergencySubstitution: false,
  });
  const [result, setResult] = useState<CompatibilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await previewCompatibility(form));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const cfg = result ? MATCH_CONFIG[result.matchType] : null;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Compatibility Preview</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Test blood compatibility outcomes by component, urgency, and substitution policy.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Donor Type"      value={form.donorType}      options={BLOOD_TYPES}  onChange={(v) => setForm((f) => ({ ...f, donorType: v }))} />
          <Select label="Recipient Type"  value={form.recipientType}  options={BLOOD_TYPES}  onChange={(v) => setForm((f) => ({ ...f, recipientType: v }))} />
          <Select label="Component"       value={form.component}      options={COMPONENTS}   onChange={(v) => setForm((f) => ({ ...f, component: v }))} />
          <Select label="Urgency"         value={form.urgency}        options={URGENCIES}    onChange={(v) => setForm((f) => ({ ...f, urgency: v }))} />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={form.allowEmergencySubstitution ?? false}
            onChange={(e) => setForm((f) => ({ ...f, allowEmergencySubstitution: e.target.checked }))}
            className="rounded"
          />
          Allow emergency substitution
        </label>

        <button
          onClick={run}
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-[#D32F2F] text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {loading ? "Checking…" : "Check Compatibility"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {result && cfg && (
        <div className={`rounded-xl border p-5 ${cfg.bg} border-gray-200`}>
          <div className="flex items-center gap-2 mb-3">
            <cfg.icon className={`w-5 h-5 ${cfg.color}`} />
            <span className={`font-semibold ${cfg.color}`}>{cfg.label}</span>
            {result.emergencySubstitution && (
              <span className="ml-auto text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                Emergency policy active
              </span>
            )}
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">{result.explanation}</p>
        </div>
      )}
    </div>
  );
}
