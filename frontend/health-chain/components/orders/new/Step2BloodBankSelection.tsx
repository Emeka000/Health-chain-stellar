import React from "react";
import { BloodBankAvailability, BloodType, StockLevel } from "@/lib/types/orders";
import { BloodBankMap } from "./BloodBankMap";
import { AlertCircle, Clock, MapPin, RefreshCw } from "lucide-react";
import { useTranslations } from 'next-intl';

interface Step2Props {
  bloodType: BloodType;
  quantity: number;
  bloodBanks: BloodBankAvailability[];
  selectedBankId: string | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  hospitalLat: number;
  hospitalLng: number;
  onSelectBank: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
  onRefresh: () => void;
}

export const Step2BloodBankSelection: React.FC<Step2Props> = ({
  bloodType,
  quantity,
  bloodBanks,
  selectedBankId,
  loading,
  error,
  lastUpdated,
  hospitalLat,
  hospitalLng,
  onSelectBank,
  onNext,
  onBack,
  onRefresh,
}) => {
  const t = useTranslations('CreateRequest.step2');
  const commonT = useTranslations('Common');
  
  const STOCK_BADGE: Record<StockLevel, { label: string; classes: string }> = {
    adequate: { label: t('stockLevels.adequate'), classes: "bg-green-100 text-green-700" },
    low: { label: t('stockLevels.low'), classes: "bg-amber-100 text-amber-700" },
    critical: { label: t('stockLevels.critical'), classes: "bg-red-100 text-red-700" },
    out_of_stock: { label: t('stockLevels.outOfStock'), classes: "bg-gray-100 text-gray-500" },
  };

  const selectedBank = bloodBanks.find((b) => b.id === selectedBankId);
  const canProceed =
    selectedBank &&
    selectedBank.stock[bloodType] >= quantity &&
    selectedBank.stockLevel !== "out_of_stock";

  return (
    <div role="group" aria-labelledby="step2-title">
      <h2 id="step2-title" className="text-xl font-bold text-gray-900 mb-1">{t('title')}</h2>
      <p className="text-sm text-gray-500 mb-2">
        {t('description')}
      </p>

      {/* Last updated + refresh */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-gray-400" aria-live="polite">
          {lastUpdated
            ? t('lastUpdated', { seconds: Math.round((Date.now() - lastUpdated.getTime()) / 1000) })
            : t('fetching')}
        </span>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-black transition-colors focus-visible:ring-1 focus-visible:ring-black rounded px-1 outline-none"
          aria-label={t('refreshCta')}
        >
          <RefreshCw size={12} aria-hidden="true" />
          {t('refreshCta')}
        </button>
      </div>

      {/* Map */}
      <div className="mb-5">
        <BloodBankMap
          bloodBanks={bloodBanks}
          hospitalLat={hospitalLat}
          hospitalLng={hospitalLng}
          selectedId={selectedBankId}
          bloodType={bloodType}
          onSelect={onSelectBank}
        />
        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500" aria-label="Stock level legend">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-[#00BFA5] inline-block" aria-hidden="true" /> {t('stockLevels.adequate')}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-[#FFA500] inline-block" aria-hidden="true" /> {t('stockLevels.low')}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-[#D32F2F] inline-block" aria-hidden="true" /> {t('stockLevels.critical')}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-gray-400 inline-block" aria-hidden="true" /> {t('stockLevels.outOfStock')}
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Blood bank list */}
      <div className="space-y-3 mb-6" role="list" aria-label="Available Blood Banks">
        {loading && bloodBanks.length === 0 ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" role="presentation" />
          ))
        ) : bloodBanks.length === 0 ? (
          <div className="py-10 text-center text-gray-400" role="status">
            {t('noBanksFound')}
          </div>
        ) : (
          bloodBanks.map((bank) => {
            const stock = bank.stock[bloodType] ?? 0;
            const isOutOfStock = bank.stockLevel === "out_of_stock" || stock === 0;
            const hasEnough = stock >= quantity;
            const isSelected = bank.id === selectedBankId;
            const badge = STOCK_BADGE[bank.stockLevel];

            return (
              <button
                key={bank.id}
                onClick={() => !isOutOfStock && onSelectBank(bank.id)}
                disabled={isOutOfStock}
                role="listitem"
                aria-selected={isSelected}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 outline-none ${
                  isSelected
                    ? "border-black bg-gray-50"
                    : isOutOfStock
                      ? "border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed"
                      : "border-gray-200 bg-white hover:border-gray-400"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{bank.name}</p>
                    <p className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                      <MapPin size={11} aria-hidden="true" />
                      {t('distance', { distance: bank.distanceKm.toFixed(1) })}
                    </p>
                    {isOutOfStock && (
                      <p className="mt-1 text-xs text-red-600 flex items-center gap-1" role="status">
                        <AlertCircle size={11} aria-hidden="true" />
                        {t('noStock', { type: bloodType })}
                      </p>
                    )}
                    {!isOutOfStock && !hasEnough && (
                      <p className="mt-1 text-xs text-amber-600 flex items-center gap-1" role="status">
                        <AlertCircle size={11} aria-hidden="true" />
                        {t('notEnoughStock', { count: stock, needed: quantity })}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                    <span className="text-xs text-gray-500 font-medium">
                      {t('unitsCount', { count: stock })}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock size={11} aria-hidden="true" />
                      ~{t('deliveryTime', { minutes: bank.estimatedDeliveryMinutes })}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 border-2 border-gray-200 text-gray-700 font-semibold rounded-xl hover:border-gray-400 transition-colors focus-visible:ring-2 focus-visible:ring-black outline-none"
        >
          {commonT('back')}
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="flex-1 py-3 bg-black text-white font-semibold rounded-xl hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-black outline-none"
        >
          {t('cta')}
        </button>
      </div>
    </div>
  );
};
