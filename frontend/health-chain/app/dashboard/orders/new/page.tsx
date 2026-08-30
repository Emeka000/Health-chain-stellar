"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import {
  BloodType,
  BloodBankAvailability,
  NewOrderPayload,
} from "@/lib/types/orders";
import { StepIndicator } from "@/components/orders/new/StepIndicator";
import { Step1BloodSelection } from "@/components/orders/new/Step1BloodSelection";
import { Step2BloodBankSelection } from "@/components/orders/new/Step2BloodBankSelection";
import { Step3Confirmation } from "@/components/orders/new/Step3Confirmation";
import { useAuthStore } from "@/lib/stores/auth.store";
import { placeOrder } from "@/lib/api/orders.api";
import { fetchBloodBankAvailability } from "@/lib/api/bloodBanks.api";

const HOSPITAL_LAT = 6.5244;
const HOSPITAL_LNG = 3.3792;

const STEPS = [
  { number: 1, label: "Blood Type" },
  { number: 2, label: "Blood Bank" },
  { number: 3, label: "Confirm" },
];

const POLLING_INTERVAL_MS = 30_000;

export default function NewOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const hospitalId = (user?.hospitalId as string | undefined) ?? user?.id ?? "";

  // Read step from URL, default to 1
  const stepFromUrl = Number(searchParams.get("step")) || 1;
  const [currentStep, setCurrentStep] = useState<number>(
    stepFromUrl >= 1 && stepFromUrl <= 3 ? stepFromUrl : 1,
  );

  // Step 1 state
  const [bloodType, setBloodType] = useState<BloodType | null>(null);
  const [quantity, setQuantity] = useState<number>(1);

  // Step 2 state
  const [bloodBanks, setBloodBanks] = useState<BloodBankAvailability[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [banksLoading, setBanksLoading] = useState(false);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync step to URL
  const goToStep = useCallback(
    (step: number) => {
      setCurrentStep(step);
      const params = new URLSearchParams(searchParams.toString());
      params.set("step", String(step));
      router.replace(`/dashboard/orders/new?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  // Fetch blood bank availability
  const fetchBloodBanks = useCallback(
    async (silent = false) => {
      if (!bloodType || !hospitalId) return;
      if (!silent) setBanksLoading(true);
      setBanksError(null);
      try {
        const banks = await fetchBloodBankAvailability(bloodType, hospitalId);
        setBloodBanks(banks);
        setLastUpdated(new Date());
      } catch (err) {
        setBanksError(
          err instanceof Error ? err.message : "Failed to load blood bank availability.",
        );
      } finally {
        setBanksLoading(false);
      }
    },
    [bloodType, hospitalId],
  );

  // Set up WebSocket + polling when on step 2
  useEffect(() => {
    if (currentStep !== 2 || !bloodType) return;

    fetchBloodBanks();

    // WebSocket for real-time stock updates
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:3000";
    const socket = io(`${wsUrl}/blood-banks`, {
      reconnection: true,
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("stock:updated", (update: Partial<BloodBankAvailability>) => {
      setBloodBanks((prev) =>
        prev.map((bb) => (bb.id === update.id ? { ...bb, ...update } : bb)),
      );
      setLastUpdated(new Date());
    });

    // Polling fallback every 30s
    pollingRef.current = setInterval(() => {
      fetchBloodBanks(true);
    }, POLLING_INTERVAL_MS);

    return () => {
      socket.disconnect();
      socketRef.current = null;
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [currentStep, bloodType, fetchBloodBanks]);

  // Step 1 -> 2
  const handleStep1Next = (selectedBloodType: BloodType, selectedQuantity: number) => {
    setBloodType(selectedBloodType);
    setQuantity(selectedQuantity);
    setSelectedBankId(null);
    goToStep(2);
  };

  // Step 2 -> 3
  const handleStep2Next = () => {
    goToStep(3);
  };

  // Place order
  const handleConfirmOrder = async () => {
    if (!bloodType || !selectedBankId) throw new Error("Missing order details.");

    const payload: NewOrderPayload = {
      hospitalId,
      bloodType,
      quantity,
      bloodBankId: selectedBankId,
    };

    const data = await placeOrder(payload);
    router.push(`/dashboard/orders?newOrder=${data.orderId}`);
  };

  const selectedBank = bloodBanks.find((b) => b.id === selectedBankId) ?? null;

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-6">
        <button
          onClick={() => router.push("/dashboard/orders")}
          className="text-sm text-gray-500 hover:text-black transition-colors mb-4 flex items-center gap-1"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 12L6 8L10 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to Orders
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Place New Order</h1>
        <p className="text-sm text-gray-500 mt-1">
          Request blood units from a nearby blood bank.
        </p>
      </div>

      <StepIndicator steps={STEPS} currentStep={currentStep} />

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        {currentStep === 1 && (
          <Step1BloodSelection
            bloodType={bloodType}
            quantity={quantity}
            onNext={handleStep1Next}
          />
        )}

        {currentStep === 2 && bloodType && (
          <Step2BloodBankSelection
            bloodType={bloodType}
            quantity={quantity}
            bloodBanks={bloodBanks}
            selectedBankId={selectedBankId}
            loading={banksLoading}
            error={banksError}
            lastUpdated={lastUpdated}
            hospitalLat={HOSPITAL_LAT}
            hospitalLng={HOSPITAL_LNG}
            onSelectBank={setSelectedBankId}
            onNext={handleStep2Next}
            onBack={() => goToStep(1)}
            onRefresh={() => fetchBloodBanks()}
          />
        )}

        {currentStep === 3 && bloodType && selectedBank && (
          <Step3Confirmation
            bloodType={bloodType}
            quantity={quantity}
            bloodBank={selectedBank}
            onConfirm={handleConfirmOrder}
            onBack={() => goToStep(2)}
          />
        )}

        {/* Guard: if step 2 or 3 reached without required state, bounce back */}
        {currentStep === 2 && !bloodType && (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">Please complete Step 1 first.</p>
            <button
              onClick={() => goToStep(1)}
              className="px-4 py-2 bg-black text-white rounded-xl text-sm font-semibold"
            >
              Go to Step 1
            </button>
          </div>
        )}

        {currentStep === 3 && (!bloodType || !selectedBank) && (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">
              Please complete the previous steps first.
            </p>
            <button
              onClick={() => goToStep(bloodType ? 2 : 1)}
              className="px-4 py-2 bg-black text-white rounded-xl text-sm font-semibold"
            >
              Go Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
