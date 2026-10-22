'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEscalations } from '@/lib/hooks/useEscalations';
import type { Escalation, EscalationTier } from '@/lib/types/escalation';

const TIER_COLORS: Record<EscalationTier, string> = {
  TIER_1: 'bg-yellow-100 border-yellow-400 text-yellow-800',
  TIER_2: 'bg-orange-100 border-orange-400 text-orange-800',
  TIER_3: 'bg-red-100 border-red-500 text-red-900',
};

const TIER_TRANSLATION_KEYS: Record<EscalationTier, string> = {
  TIER_1: 'tier_1_label',
  TIER_2: 'tier_2_label',
  TIER_3: 'tier_3_label',
};

function SlaCountdown({ deadlineMs }: { deadlineMs: number }) {
  const { t } = useTranslation('emergency');
  const [remaining, setRemaining] = useState(() => Math.max(0, deadlineMs - Date.now()));

  useEffect(() => {
    const id = setInterval(() => setRemaining(Math.max(0, deadlineMs - Date.now())), 1000);
    return () => clearInterval(id);
  }, [deadlineMs]);

  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1000);
  const expired = remaining === 0;

  return (
    <span className={`font-mono text-sm font-semibold ${expired ? 'text-red-600' : 'text-gray-700'}`}>
      {expired
        ? t('sla_expired')
        : t('sla_countdown', { minutes: mins, seconds: secs.toString().padStart(2, '0') })}
    </span>
  );
}

function EscalationRow({
  escalation,
  onAcknowledge,
}: {
  escalation: Escalation;
  onAcknowledge: (id: string) => void;
}) {
  const { t } = useTranslation('emergency');
  const colorClass = TIER_COLORS[escalation.tier];

  return (
    <div className={`border rounded-lg p-4 flex flex-col gap-2 ${colorClass}`}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-sm">{t(TIER_TRANSLATION_KEYS[escalation.tier])}</span>
        <SlaCountdown deadlineMs={escalation.slaDeadlineMs} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 text-xs">
        <span><span className="font-medium">{t('field_request')}:</span> {escalation.requestId.slice(0, 8)}…</span>
        {escalation.orderId && (
          <span><span className="font-medium">{t('field_order')}:</span> {escalation.orderId.slice(0, 8)}…</span>
        )}
        {escalation.riderId && (
          <span><span className="font-medium">{t('field_rider')}:</span> {escalation.riderId.slice(0, 8)}…</span>
        )}
        <span><span className="font-medium">{t('field_hospital')}:</span> {escalation.hospitalId.slice(0, 8)}…</span>
      </div>

      <button
        onClick={() => onAcknowledge(escalation.id)}
        className="self-end mt-1 px-3 py-1 text-xs font-semibold rounded bg-white border border-current hover:opacity-80 transition-opacity"
      >
        {t('acknowledge')}
      </button>
    </div>
  );
}

export default function EmergencyOperationsPanel() {
  const { t } = useTranslation('emergency');
  const { escalations, isLoading, acknowledge } = useEscalations();

  if (isLoading) {
    return (
      <div className="p-6 text-center text-gray-500 text-sm">{t('loading_escalations')}</div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">{t('panel_title')}</h2>
        <span className="text-xs bg-red-600 text-white rounded-full px-2 py-0.5 font-semibold">
          {t('open_count_other', { count: escalations.length })}
        </span>
      </div>

      {escalations.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">{t('no_active_escalations')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {escalations.map((e) => (
            <EscalationRow key={e.id} escalation={e} onAcknowledge={acknowledge} />
          ))}
        </div>
      )}
    </div>
  );
}
