import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { BloodType } from "@/lib/types/orders";

const BLOOD_TYPES: BloodType[] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

interface Step1Props {
  bloodType: BloodType | null;
  quantity: number;
  onNext: (bloodType: BloodType, quantity: number) => void;
}

export const Step1BloodSelection: React.FC<Step1Props> = ({
  bloodType: initialBloodType,
  quantity: initialQuantity,
  onNext,
}) => {
  const { t } = useTranslation('orders');
  const [selectedBloodType, setSelectedBloodType] = useState<BloodType | null>(initialBloodType);
  const [quantity, setQuantity] = useState<number>(initialQuantity || 1);
  const [error, setError] = useState<string | null>(null);

  const handleNext = () => {
    if (!selectedBloodType) {
      setError(t('order_blood_type_required'));
      return;
    }
    if (quantity < 1 || quantity > 50) {
      setError(t('order_quantity_required'));
      return;
    }
    setError(null);
    onNext(selectedBloodType, quantity);
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">
        {t('order_step_1')}
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        {t('order_create_description')}
      </p>

      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          {t('order_blood_type_label')}
        </label>
        <div className="grid grid-cols-4 gap-3">
          {BLOOD_TYPES.map((bt) => (
            <button
              key={bt}
              onClick={() => setSelectedBloodType(bt)}
              aria-pressed={selectedBloodType === bt}
              className={`h-14 rounded-xl border-2 font-bold text-lg transition-all ${
                selectedBloodType === bt
                  ? "border-black bg-black text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
              }`}
            >
              {bt}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          {t('order_quantity_label')}
        </label>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            aria-label={t('previous')}
            className="w-10 h-10 rounded-full border-2 border-gray-200 flex items-center justify-center text-xl font-bold text-gray-600 hover:border-gray-400 transition-colors"
          >
            -
          </button>
          <input
            type="number"
            min={1}
            max={50}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            aria-label={t('order_quantity_label')}
            className="w-20 text-center border-2 border-gray-200 rounded-xl py-2 text-lg font-bold text-gray-900 focus:outline-none focus:border-black"
          />
          <button
            onClick={() => setQuantity((q) => Math.min(50, q + 1))}
            aria-label={t('next')}
            className="w-10 h-10 rounded-full border-2 border-gray-200 flex items-center justify-center text-xl font-bold text-gray-600 hover:border-gray-400 transition-colors"
          >
            +
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      <button
        onClick={handleNext}
        className="w-full py-3 bg-black text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors"
      >
        {t('order_step_2')}
      </button>
    </div>
  );
};
