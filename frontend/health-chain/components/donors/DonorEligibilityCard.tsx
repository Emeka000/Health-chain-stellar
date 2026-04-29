"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";
import { useLocaleFormat } from "@/lib/hooks/useLocaleFormat";

interface DeferralRecord {
  id: string;
  reason: string;
  deferredUntil: string | null;
  notes: string | null;
  createdAt: string;
  isActive: boolean;
}

interface EligibilityResult {
  donorId: string;
  status: "eligible" | "deferred" | "permanently_excluded";
  nextEligibleDate: string | null;
  activeDeferrals: DeferralRecord[];
}

interface Props {
  eligibility: EligibilityResult;
}

const STATUS_CONFIG = {
  eligible:             { icon: CheckCircle, color: "text-green-600", bg: "bg-green-50", key: "eligibility_eligible" },
  deferred:             { icon: Clock,        color: "text-yellow-600", bg: "bg-yellow-50", key: "eligibility_deferred" },
  permanently_excluded: { icon: XCircle,      color: "text-red-600",   bg: "bg-red-50",    key: "eligibility_permanently_excluded" },
} as const;

/** Maps snake_case deferral reason codes to medical glossary keys. */
function deferralReasonKey(reason: string): string {
  const map: Record<string, string> = {
    low_hemoglobin:   'deferral_reason_low_hemoglobin',
    recent_illness:   'deferral_reason_recent_illness',
    recent_travel:    'deferral_reason_recent_travel',
    medication:       'deferral_reason_medication',
    recent_donation:  'deferral_reason_recent_donation',
  };
  return map[reason] ?? 'deferral_reason_other';
}

export function DonorEligibilityCard({ eligibility }: Props) {
  const { t } = useTranslation('medical');
  const { formatDateShort } = useLocaleFormat();
  const cfg = STATUS_CONFIG[eligibility.status];
  const Icon = cfg.icon;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg ${cfg.bg}`}>
        <Icon className={cfg.color} size={20} />
        <div>
          <p className={`font-semibold ${cfg.color}`}>{t(cfg.key)}</p>
          {eligibility.nextEligibleDate && (
            <p className="text-xs text-gray-500">
              {t('eligibility_next_eligible', { date: formatDateShort(eligibility.nextEligibleDate) })}
            </p>
          )}
        </div>
      </div>

      {eligibility.activeDeferrals.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {t('eligibility_active_deferrals')}
          </p>
          {eligibility.activeDeferrals.map((d) => (
            <div key={d.id} className="flex items-start gap-2 text-sm border border-yellow-100 bg-yellow-50 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="text-yellow-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-gray-700">{t(deferralReasonKey(d.reason))}</p>
                {d.deferredUntil && (
                  <p className="text-xs text-gray-500">
                    {t('eligibility_deferral_until', { date: formatDateShort(d.deferredUntil) })}
                  </p>
                )}
                {d.notes && <p className="text-xs text-gray-400 mt-0.5">{d.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
