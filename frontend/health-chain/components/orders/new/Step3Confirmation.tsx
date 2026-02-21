import React, { useState } from "react";
import { BloodBankAvailability, BloodType } from "@/lib/types/orders";
import { CheckCircle2, Clock, MapPin, Droplets, Loader2 } from "lucide-react";

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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to place order. Please try again.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Confirm Your Order</h2>
      <p className="text-sm text-gray-500 mb-6">
        Review the details below before placing your order.
      </p>

      <div className="bg-gray-50 rounded-2xl p-5 space-y-4 mb-6">
        {/* Blood type + quantity */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-black text-white rounded-xl flex items-center justify-center font-bold text-lg shrink-0">
            {bloodType}
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              Blood Type
            </p>
            <p className="text-lg font-bold text-gray-900">{bloodType}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              Quantity
            </p>
            <p className="text-lg font-bold text-gray-900">
              {quantity} {quantity === 1 ? "unit" : "units"}
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200" />

        {/* Blood bank */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0 mt-0.5">
            <Droplets size={16} className="text-red-500" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              Blood Bank
            </p>
            <p className="font-semibold text-gray-900">{bloodBank.name}</p>
          </div>
        </div>

        {/* Location */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0 mt-0.5">
            <MapPin size={16} className="text-gray-500" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              Distance
            </p>
            <p className="font-semibold text-gray-900">
              {bloodBank.distanceKm.toFixed(1)} km away
            </p>
          </div>
        </div>

        {/* Estimated delivery */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0 mt-0.5">
            <Clock size={16} className="text-amber-500" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              Estimated Delivery
            </p>
            <p className="font-semibold text-gray-900">
              ~{bloodBank.estimatedDeliveryMinutes} minutes
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200" />

        {/* Confirmation note */}
        <div className="flex items-start gap-2">
          <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500 leading-relaxed">
            By confirming, you authorize the placement of this order. A rider will be
            dispatched once the blood bank confirms availability.
          </p>
        </div>
      </div>

      {submitError && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          {submitError}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-3 border-2 border-gray-200 text-gray-700 font-semibold rounded-xl hover:border-gray-400 disabled:opacity-40 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleConfirm}
          disabled={submitting}
          className="flex-1 py-3 bg-black text-white font-semibold rounded-xl hover:bg-gray-800 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Placing Order...
            </>
          ) : (
            "Place Order"
          )}
        </button>
      </div>
    </div>
  );
};
