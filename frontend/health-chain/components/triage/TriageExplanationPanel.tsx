'use client';

type TriageExplanationPanelProps = {
  score: number;
  policyVersion: string;
  factors: Array<{ label: string; value: number; detail: string }>;
  emergencyOverride?: boolean;
};

export function TriageExplanationPanel({
  score,
  policyVersion,
  factors,
  emergencyOverride = false,
}: TriageExplanationPanelProps) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
            Triage Explanation
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">
            Deterministic priority breakdown
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Every request keeps its stored factor snapshot and policy version so
            operators can explain why it ranked where it did.
          </p>
        </div>

        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-right">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
            Total Score
          </div>
          <div className="text-3xl font-bold text-amber-900">{score}</div>
          <div className="text-xs text-amber-800">Policy {policyVersion}</div>
        </div>
      </div>

      {emergencyOverride ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Emergency override applied. This request is promoted above weighted
          scoring.
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {factors.map((factor) => (
          <article
            key={factor.label}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">
                {factor.label}
              </h3>
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
                {factor.value}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{factor.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
