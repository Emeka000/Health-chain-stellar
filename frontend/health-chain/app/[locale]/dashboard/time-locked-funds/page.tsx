"use client";
import React, { useEffect, useState } from "react";
import { Clock, CheckCircle2, Circle, AlertTriangle, Lock } from "lucide-react";

interface Milestone {
  id: string;
  label: string;
  oracleSource: string;
  triggered: boolean;
  triggeredAt?: string;
  requiresManualVerification?: boolean;
  manualVerified?: boolean;
}

interface ConditionalDonation {
  id: string;
  amount: string;
  recipient: string;
  releaseDeadline: string; // ISO string
  milestones: Milestone[];
}

const MOCK: ConditionalDonation = {
  id: "CDON-0x7f2a...b9e1",
  amount: "2,500 XLM",
  recipient: "Lagos General Hospital",
  releaseDeadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000).toISOString(),
  milestones: [
    { id: "m1", label: "Delivery Confirmed by Rider", oracleSource: "Delivery Oracle", triggered: true, triggeredAt: "Mar 25, 2026 14:32" },
    { id: "m2", label: "Temperature Threshold Maintained", oracleSource: "IoT Temperature Oracle", triggered: true, triggeredAt: "Mar 25, 2026 15:10" },
    { id: "m3", label: "Hospital Inventory Updated", oracleSource: "Inventory Oracle", triggered: false },
    {
      id: "m4",
      label: "Third-Party Auditor Sign-off",
      oracleSource: "Manual Verification",
      triggered: false,
      requiresManualVerification: true,
      manualVerified: false,
    },
  ],
};

function useCountdown(deadline: string) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, new Date(deadline).getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const totalSecs = Math.floor(remaining / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return { days, hours, mins, secs, expired: remaining === 0 };
}

function CountdownTimer({ deadline }: { deadline: string }) {
  const { days, hours, mins, secs, expired } = useCountdown(deadline);

  if (expired) {
    return (
      <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-[12px] px-5 py-3">
        <AlertTriangle size={16} className="text-[#D32F2F]" />
        <span className="text-[13px] font-bold text-[#D32F2F]">Time-lock expired — manual review required</span>
      </div>
    );
  }

  const units = [
    { label: "Days", value: days },
    { label: "Hours", value: hours },
    { label: "Mins", value: mins },
    { label: "Secs", value: secs },
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 text-[#5C5B5B]">
        <Clock size={15} />
        <span className="text-[12px] font-medium">Release in</span>
      </div>
      <div className="flex gap-2">
        {units.map(({ label, value }) => (
          <div key={label} className="flex flex-col items-center bg-[#F8F8F8] rounded-[10px] px-3 py-2 min-w-[52px]">
            <span className="text-[20px] font-bold text-brand-black leading-none tabular-nums">
              {String(value).padStart(2, "0")}
            </span>
            <span className="text-[9px] text-[#5C5B5B] uppercase tracking-wider mt-0.5">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MilestoneItem({ milestone }: { milestone: Milestone }) {
  const needsAction = milestone.requiresManualVerification && !milestone.manualVerified && !milestone.triggered;

  return (
    <div
      className={`flex items-start gap-4 p-4 rounded-[14px] border transition-all
        ${milestone.triggered ? "bg-green-50 border-green-200" : needsAction ? "bg-amber-50 border-amber-300" : "bg-white border-gray-100"}`}
    >
      <div className="mt-0.5 shrink-0">
        {milestone.triggered ? (
          <CheckCircle2 size={20} className="text-green-600" />
        ) : needsAction ? (
          <AlertTriangle size={20} className="text-amber-500" />
        ) : (
          <Circle size={20} className="text-gray-300" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className={`text-[14px] font-semibold ${milestone.triggered ? "text-green-800" : needsAction ? "text-amber-800" : "text-[#5C5B5B]"}`}>
            {milestone.label}
          </p>
          {needsAction && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300 px-2.5 py-0.5 rounded-full">
              Action Required
            </span>
          )}
        </div>
        <p className="text-[11px] text-[#5C5B5B] mt-0.5">Source: {milestone.oracleSource}</p>
        {milestone.triggeredAt && (
          <p className="text-[11px] text-green-600 mt-0.5 font-medium">✓ Triggered {milestone.triggeredAt}</p>
        )}
        {needsAction && (
          <p className="text-[11px] text-amber-600 mt-1">
            A third-party auditor must verify this condition before funds can be released.
          </p>
        )}
      </div>
    </div>
  );
}

export default function TimeLockedFundsPage() {
  const donation = MOCK;
  const completedCount = donation.milestones.filter((m) => m.triggered).length;
  const total = donation.milestones.length;
  const progressPct = Math.round((completedCount / total) * 100);
  const hasActionRequired = donation.milestones.some(
    (m) => m.requiresManualVerification && !m.manualVerified && !m.triggered
  );

  return (
    <div className="min-h-screen bg-[#F8F8F8] font-poppins p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-[28px] font-bold text-brand-black tracking-[0.03em]">Conditional Donation</h1>
          <p className="text-[14px] text-[#5C5B5B] mt-1">
            Funds held in escrow until all on-chain conditions are satisfied.
          </p>
        </div>

        {/* Summary card */}
        <div className="bg-white rounded-[20px] shadow-[0px_4px_20px_rgba(0,0,0,0.05)] p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
            <div>
              <p className="text-[12px] text-[#5C5B5B] mb-0.5">Donation ID</p>
              <p className="text-[13px] font-mono font-semibold text-brand-black">{donation.id}</p>
            </div>
            <div className="text-right sm:text-right">
              <p className="text-[24px] font-bold text-[#D32F2F]">{donation.amount}</p>
              <p className="text-[12px] text-[#5C5B5B]">→ {donation.recipient}</p>
            </div>
          </div>

          {/* Escrow badge */}
          <div className="flex items-center gap-2 mb-5">
            <Lock size={14} className="text-[#D32F2F]" />
            <span className="text-[12px] font-semibold text-[#D32F2F]">Funds locked in Soroban escrow</span>
          </div>

          <CountdownTimer deadline={donation.releaseDeadline} />

          {/* Progress bar */}
          <div className="mt-5">
            <div className="flex justify-between text-[12px] text-[#5C5B5B] mb-1.5">
              <span>Milestone Progress</span>
              <span className="font-semibold">{completedCount}/{total} complete</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#D32F2F] rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Action Required banner */}
        {hasActionRequired && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-[14px] px-5 py-4 mb-6">
            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-bold text-amber-800">Action Required</p>
              <p className="text-[12px] text-amber-700 mt-0.5">
                One or more milestones require manual verification from a third-party auditor before funds can be released.
              </p>
            </div>
          </div>
        )}

        {/* Milestone checklist */}
        <div className="bg-white rounded-[20px] shadow-[0px_4px_20px_rgba(0,0,0,0.05)] p-6">
          <h2 className="text-[16px] font-bold text-brand-black mb-4">Milestone Checklist</h2>
          <div className="flex flex-col gap-3">
            {donation.milestones.map((m) => (
              <MilestoneItem key={m.id} milestone={m} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
