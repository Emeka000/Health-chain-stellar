"use client";

import React, { useEffect, useState } from "react";
import { useCreateOnboarding, useOnboarding, useSaveStep, useSubmitOnboarding } from "@/lib/hooks/useOnboarding";
import type { OnboardingStep } from "@/lib/types/onboarding";

const STEPS: { key: OnboardingStep; label: string; fields: { name: string; label: string; type?: string; required?: boolean }[] }[] = [
  {
    key: "profile",
    label: "Organization Profile",
    fields: [
      { name: "name", label: "Organization Name", required: true },
      { name: "legalName", label: "Legal Name", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "phone", label: "Phone", required: true },
      { name: "address", label: "Address" },
      { name: "website", label: "Website" },
    ],
  },
  {
    key: "compliance",
    label: "Compliance & Licensing",
    fields: [
      { name: "licenseNumber", label: "License Number", required: true },
      { name: "registrationNumber", label: "Registration Number", required: true },
      { name: "licenseDocumentUrl", label: "License Document URL", required: true },
    ],
  },
  {
    key: "contacts",
    label: "Contact Users",
    fields: [
      { name: "contactName", label: "Primary Contact Name", required: true },
      { name: "contactEmail", label: "Primary Contact Email", type: "email", required: true },
      { name: "contactPhone", label: "Contact Phone" },
    ],
  },
  {
    key: "service_areas",
    label: "Service Areas",
    fields: [
      { name: "serviceAreas", label: "Service Areas (comma-separated)", required: true },
      { name: "coverageRadius", label: "Coverage Radius (km)" },
    ],
  },
  {
    key: "wallet",
    label: "Wallet Setup",
    fields: [
      { name: "walletAddress", label: "Stellar Wallet Address", required: true },
    ],
  },
];

const ORG_TYPES = ["HOSPITAL", "BLOOD_BANK", "COLLECTION_CENTER"];

export default function OnboardingWizardPage() {
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [orgType, setOrgType] = useState("HOSPITAL");
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({});
  const [started, setStarted] = useState(false);

  const createMutation = useCreateOnboarding();
  const { data: onboarding } = useOnboarding(onboardingId ?? "");
  const saveStep = useSaveStep(onboardingId ?? "");
  const submitMutation = useSubmitOnboarding(onboardingId ?? "");

  // Restore saved data when onboarding loads
  useEffect(() => {
    if (onboarding?.data) {
      const restored: Record<string, Record<string, string>> = {};
      for (const [k, v] of Object.entries(onboarding.data)) {
        restored[k] = Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([fk, fv]) => [fk, String(fv ?? "")])
        );
      }
      setFormData(restored);
      const savedIdx = STEPS.findIndex((s) => s.key === onboarding.currentStep);
      if (savedIdx >= 0) setStepIndex(savedIdx);
    }
  }, [onboarding]);

  const currentStep = STEPS[stepIndex];
  const stepData = formData[currentStep.key] ?? {};

  const handleStart = async () => {
    const result = await createMutation.mutateAsync(orgType);
    setOnboardingId(result.id);
    setStarted(true);
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [currentStep.key]: { ...(prev[currentStep.key] ?? {}), [field]: value },
    }));
  };

  const handleSave = async () => {
    if (!onboardingId) return;
    const data = formData[currentStep.key] ?? {};
    // Coerce service_areas to array
    const payload = currentStep.key === "service_areas" && typeof data["serviceAreas"] === "string"
      ? { ...data, serviceAreas: data["serviceAreas"].split(",").map((s) => s.trim()).filter(Boolean) }
      : data;
    await saveStep.mutateAsync({ step: currentStep.key, data: payload });
  };

  const handleNext = async () => {
    await handleSave();
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };

  const handleBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const handleSubmit = async () => {
    await handleSave();
    await submitMutation.mutateAsync();
  };

  const isLastStep = stepIndex === STEPS.length - 1;
  const isSubmitted = onboarding?.status === "submitted";
  const isActivated = onboarding?.status === "activated";

  if (!started) {
    return (
      <div className="p-6 lg:p-10 max-w-lg mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Partner Onboarding</h1>
        <p className="text-gray-500 text-sm">Start the guided onboarding wizard for your organization.</p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Organization Type</label>
          <select
            value={orgType}
            onChange={(e) => setOrgType(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full"
          >
            {ORG_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <button
          onClick={handleStart}
          disabled={createMutation.isPending}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {createMutation.isPending ? "Starting…" : "Start Onboarding"}
        </button>
      </div>
    );
  }

  if (isSubmitted || isActivated) {
    return (
      <div className="p-6 lg:p-10 max-w-lg mx-auto space-y-4">
        <div className="p-6 bg-green-50 border border-green-200 rounded-lg text-center">
          <p className="text-green-700 font-semibold text-lg">
            {isActivated ? "✓ Organization Activated!" : "✓ Submitted for Review"}
          </p>
          <p className="text-green-600 text-sm mt-1">
            {isActivated
              ? `Organization ID: ${onboarding?.organizationId}`
              : "An admin will review your submission shortly."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Partner Onboarding</h1>
        <p className="text-gray-400 text-xs mt-1">ID: {onboardingId}</p>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.key}>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold
              ${i < stepIndex ? "bg-green-500 text-white" : i === stepIndex ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"}`}>
              {i < stepIndex ? "✓" : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-1 rounded ${i < stepIndex ? "bg-green-400" : "bg-gray-200"}`} />
            )}
          </React.Fragment>
        ))}
      </div>
      <p className="text-sm font-semibold text-gray-700">{currentStep.label}</p>

      {/* Step form */}
      <div className="space-y-4">
        {currentStep.fields.map((f) => (
          <div key={f.name}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {f.label}{f.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type={f.type ?? "text"}
              value={stepData[f.name] ?? ""}
              onChange={(e) => handleChange(f.name, e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={handleBack}
          disabled={stepIndex === 0}
          className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40"
        >
          Back
        </button>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saveStep.isPending}
            className="px-4 py-2 text-sm border border-blue-300 text-blue-600 rounded-md hover:bg-blue-50 disabled:opacity-50"
          >
            {saveStep.isPending ? "Saving…" : "Save Draft"}
          </button>
          {isLastStep ? (
            <button
              onClick={handleSubmit}
              disabled={submitMutation.isPending || saveStep.isPending}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {submitMutation.isPending ? "Submitting…" : "Submit for Review"}
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={saveStep.isPending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
