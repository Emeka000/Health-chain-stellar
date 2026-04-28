'use client';

import { TriageExplanationPanel } from '@/components/triage/TriageExplanationPanel';

const example = {
  score: 412,
  policyVersion: '2026-03-30.v1',
  emergencyOverride: false,
  factors: [
    { label: 'Urgency', value: 100, detail: 'Critical deadline with near-term need.' },
    { label: 'Criticality', value: 80, detail: 'Clinical item priority is marked HIGH.' },
    { label: 'Quantity', value: 40, detail: 'Requested volume is moderate relative to queue norms.' },
    { label: 'Time', value: 80, detail: 'Required-by time is within the urgent scoring window.' },
    { label: 'Scarcity', value: 67, detail: 'Available inventory only partially covers the request.' },
    { label: 'Inventory Pressure', value: 75, detail: 'Fulfilling this request would materially tighten stock.' },
  ],
};

export default function AdminTriagePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff7ed,_#f8fafc_45%,_#e2e8f0)] p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
            Admin Triage
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900">
            Priority scoring is now explainable
          </h1>
          <p className="mt-3 max-w-3xl text-base text-slate-600">
            The backend stores raw factor snapshots alongside each computed
            triage score so operators can review the exact reasoning used for
            queue placement.
          </p>
        </header>

        <TriageExplanationPanel {...example} />
      </div>
    </main>
  );
}
