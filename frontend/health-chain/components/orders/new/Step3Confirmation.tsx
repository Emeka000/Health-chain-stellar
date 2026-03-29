import React, { useState } from "react";
import { BloodBankAvailability, BloodType } from "@/lib/types/orders";
import { CheckCircle2, Clock, MapPin, Droplets, Loader2 } from "lucide-react";
import { useTranslations } from 'next-intl';

interface Step3Props {
  bloodType: BloodType;
  quantity: number;
  bloodBank: BloodBankAvailability;
  onConfirm: () => Promise<void>;
  onBack: () => void;
}

export const Step3Confirmation: React.FC<Step3Props> = ({
  bloodType,
  quantity,
  bloodBank,
  onConfirm,
  onBack,
}) => {
  const t = useTranslations('CreateRequest.step3');
  const step1T = useTranslations('CreateRequest.step1');
  const step2T = useTranslations('CreateRequest.step2');
  const commonT = useTranslations('Common');
  
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : t('submitError'),
      );
      setSubmitting(false);
    }
  };

  return (
    <div role="group" aria-labelledby="step3-title">
      <h2 id="step3-title" className="text-xl font-bold text-gray-900 mb-1">{t('title')}</h2>
      <p className="text-sm text-gray-500 mb-6">
        {t('description')}
      </p>

      <div className="bg-gray-50 rounded-2xl p-5 space-y-4 mb-6" role="region" aria-label={t('summary')}>
        {/* Blood type + quantity */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-black text-white rounded-xl flex items-center justify-center font-bold text-lg shrink-0" aria-hidden="true">
            {bloodType}
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              {step1T('bloodType')}
            </p>
            <p className="text-lg font-bold text-gray-900">{bloodType}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              {step1T('quantity')}
            </p>
            <p className="text-lg font-bold text-gray-900">
              {step2T('unitsCount', { count: quantity })}
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200" aria-hidden="true" />

        {/* Blood bank */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0 mt-0.5">
            <Droplets size={16} className="text-red-500" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              {t('bankLabel')}
            </p>
            <p className="font-semibold text-gray-900">{bloodBank.name}</p>
          </div>
        </div>

        {/* Location */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0 mt-0.5">
            <MapPin size={16} className="text-gray-500" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              {step1T('quantity').toLowerCase() === 'quantity' ? 'Distance' : 'Distance'}
            </p>
            <p className="font-semibold text-gray-900">
              {step2T('distance', { distance: bloodBank.distanceKm.toFixed(1) })}
            </p>
          </div>
        </div>

        {/* Estimated delivery */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0 mt-0.5">
            <Clock size={16} className="text-amber-500" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              {t('deliveryLabel')}
            </p>
            <p className="font-semibold text-gray-900">
              ~{step2T('deliveryTime', { minutes: bloodBank.estimatedDeliveryMinutes })}
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200" aria-hidden="true" />

        {/* Confirmation note */}
        <div className="flex items-start gap-2">
          <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-gray-500 leading-relaxed">
            {t('confirmationNote')}
          </p>
        </div>
      </div>

      {submitError && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg" role="alert">
          {submitError}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-3 border-2 border-gray-200 text-gray-700 font-semibold rounded-xl hover:border-gray-400 disabled:opacity-40 transition-colors focus-visible:ring-2 focus-visible:ring-black outline-none"
        >
          {commonT('back')}
        </button>
        <button
          onClick={handleConfirm}
          disabled={submitting}
          className="flex-1 py-3 bg-black text-white font-semibold rounded-xl hover:bg-gray-800 disabled:opacity-60 transition-colors flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-black outline-none"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              {t('submitting')}
            </>
          ) : (
            t('cta')
          )}
        </button>
      </div>
    </div>
  );
};
