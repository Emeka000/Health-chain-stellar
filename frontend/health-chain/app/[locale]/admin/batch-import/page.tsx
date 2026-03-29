"use client";

import React, { useRef, useState } from "react";
import { useStageBatch, useBatchPreview, useCommitBatch } from "@/lib/hooks/useBatchImport";
import type { ImportEntityType, ImportStagingRow } from "@/lib/types/batch-import";

// ─── Step indicator ───────────────────────────────────────────────────────────

function Steps({ current }: { current: number }) {
  const steps = ["Upload", "Preview & Validate", "Commit"];
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <div className={`flex items-center gap-2 text-sm font-semibold ${i <= current ? "text-brand-black" : "text-gray-400"}`}>
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs border-2 ${i < current ? "bg-brand-black text-white border-brand-black" : i === current ? "border-brand-black text-brand-black" : "border-gray-300 text-gray-400"}`}>
              {i < current ? "✓" : i + 1}
            </span>
            {s}
          </div>
          {i < steps.length - 1 && <div className={`flex-1 h-0.5 ${i < current ? "bg-brand-black" : "bg-gray-200"}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Step 1: Upload ───────────────────────────────────────────────────────────

function UploadStep({
  onStaged,
}: {
  onStaged: (batchId: string) => void;
}) {
  const [entityType, setEntityType] = useState<ImportEntityType>("ORGANIZATION");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { mutate, isPending, error } = useStageBatch();

  const TEMPLATES: Record<ImportEntityType, string> = {
    ORGANIZATION: "name,type,email,phone,address,city,country,latitude,longitude",
    RIDER: "userId,vehicleType,vehicleNumber,licenseNumber,latitude,longitude",
    INVENTORY: "bloodType,region,quantity",
  };

  function downloadTemplate() {
    const blob = new Blob([TEMPLATES[entityType]], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${entityType.toLowerCase()}-template.csv`;
    a.click();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    mutate({ file, entityType }, { onSuccess: (batch) => onStaged(batch.id) });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Entity Type</label>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value as ImportEntityType)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-black"
        >
          <option value="ORGANIZATION">Organizations (Hospitals / Blood Banks)</option>
          <option value="RIDER">Riders</option>
          <option value="INVENTORY">Inventory</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-semibold text-gray-700">CSV File</label>
          <button type="button" onClick={downloadTemplate} className="text-xs text-blue-600 hover:underline">
            Download template
          </button>
        </div>
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-brand-black transition"
        >
          {file ? (
            <p className="text-sm font-medium text-brand-black">{file.name}</p>
          ) : (
            <p className="text-sm text-gray-400">Click to select a CSV file</p>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && <p className="text-red-500 text-sm">{(error as Error).message}</p>}

      <button
        type="submit"
        disabled={!file || isPending}
        className="px-6 py-2.5 bg-brand-black text-white rounded-lg font-semibold text-sm disabled:opacity-40 hover:brightness-110"
      >
        {isPending ? "Uploading…" : "Upload & Validate"}
      </button>
    </form>
  );
}

// ─── Step 2: Preview ──────────────────────────────────────────────────────────

function PreviewStep({
  batchId,
  onCommitted,
  onBack,
}: {
  batchId: string;
  onCommitted: (count: number) => void;
  onBack: () => void;
}) {
  const { data, isLoading } = useBatchPreview(batchId);
  const { mutate: commit, isPending } = useCommitBatch();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [partialMode, setPartialMode] = useState(false);

  if (isLoading || !data) return <p className="text-gray-400 text-sm">Loading preview…</p>;

  const { batch, rows } = data;
  const validRows = rows.filter((r) => r.status === "VALID");

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === validRows.length) setSelected(new Set());
    else setSelected(new Set(validRows.map((r) => r.id)));
  }

  function handleCommit() {
    const rowIds = partialMode ? [...selected] : undefined;
    commit(
      { batchId, rowIds },
      { onSuccess: (res) => onCommitted(res.committed) },
    );
  }

  const commitCount = partialMode ? selected.size : validRows.length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-xl text-sm">
        <span><span className="font-bold">{batch.totalRows}</span> total rows</span>
        <span className="text-green-600"><span className="font-bold">{batch.validRows}</span> valid</span>
        <span className="text-red-500"><span className="font-bold">{batch.invalidRows}</span> invalid</span>
        <span className="text-gray-500">File: {batch.originalFilename ?? "—"}</span>
        <label className="ml-auto flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={partialMode} onChange={(e) => { setPartialMode(e.target.checked); setSelected(new Set()); }} />
          <span>Partial acceptance</span>
        </label>
      </div>

      {/* Row table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 max-h-[420px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
            <tr>
              {partialMode && (
                <th className="px-3 py-2">
                  <input type="checkbox" checked={selected.size === validRows.length && validRows.length > 0} onChange={toggleAll} />
                </th>
              )}
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Data</th>
              <th className="px-3 py-2 text-left">Errors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.id} className={row.status === "INVALID" ? "bg-red-50" : "hover:bg-gray-50"}>
                {partialMode && (
                  <td className="px-3 py-2">
                    {row.status === "VALID" && (
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} />
                    )}
                  </td>
                )}
                <td className="px-3 py-2 text-gray-500">{row.rowIndex + 1}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full font-bold text-xs ${row.status === "VALID" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                    {row.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-700 max-w-xs truncate">
                  {Object.entries(row.data).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                </td>
                <td className="px-3 py-2 text-red-500">
                  {row.errors?.join("; ") ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">
          ← Back
        </button>
        <button
          onClick={handleCommit}
          disabled={isPending || commitCount === 0}
          className="px-6 py-2 bg-brand-black text-white rounded-lg font-semibold text-sm disabled:opacity-40 hover:brightness-110"
        >
          {isPending ? "Committing…" : `Commit ${commitCount} valid row${commitCount !== 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Done ─────────────────────────────────────────────────────────────

function DoneStep({ count, onReset }: { count: number; onReset: () => void }) {
  return (
    <div className="text-center space-y-4 py-12">
      <div className="text-5xl">✅</div>
      <h2 className="font-manrope font-bold text-2xl text-brand-black">
        {count} record{count !== 1 ? "s" : ""} imported successfully
      </h2>
      <p className="text-gray-500 text-sm">Audit log has been recorded.</p>
      <button onClick={onReset} className="px-6 py-2.5 bg-brand-black text-white rounded-lg font-semibold text-sm hover:brightness-110">
        Import another file
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BatchImportPage() {
  const [step, setStep] = useState(0);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [committedCount, setCommittedCount] = useState(0);

  function reset() {
    setStep(0);
    setBatchId(null);
    setCommittedCount(0);
  }

  return (
    <div className="p-6 lg:p-10 bg-white min-h-screen font-roboto">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="border-b border-gray-100 pb-6">
          <h1 className="text-[32px] font-manrope font-bold text-brand-black">
            Batch Import
          </h1>
          <p className="text-gray-500 mt-1">
            Import legacy organizations, riders, or inventory from CSV.
          </p>
        </div>

        <Steps current={step} />

        {step === 0 && (
          <UploadStep
            onStaged={(id) => { setBatchId(id); setStep(1); }}
          />
        )}
        {step === 1 && batchId && (
          <PreviewStep
            batchId={batchId}
            onBack={() => { setBatchId(null); setStep(0); }}
            onCommitted={(n) => { setCommittedCount(n); setStep(2); }}
          />
        )}
        {step === 2 && <DoneStep count={committedCount} onReset={reset} />}
      </div>
    </div>
  );
}
