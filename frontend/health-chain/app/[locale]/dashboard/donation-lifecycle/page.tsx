"use client";
import React, { useState } from "react";
import { DonationJourney, DonationStatus } from "@/components/donations/DonationJourney";
import { PledgeForm } from "@/components/donations/PledgeForm";

const MOCK_DONATIONS = [
  {
    donationId: "DON-0x4f3a...c12e",
    amount: "500 XLM",
    recipient: "Lagos General Hospital",
    currentStatus: "conditions_met" as DonationStatus,
    timestamps: {
      escrow: "Mar 20, 2026 09:14",
      conditions_met: "Mar 25, 2026 14:32",
    },
  },
  {
    donationId: "DON-0x9b2d...77fa",
    amount: "1,200 XLM",
    recipient: "Red Cross Kenya",
    currentStatus: "released" as DonationStatus,
    timestamps: {
      escrow: "Mar 10, 2026 11:00",
      conditions_met: "Mar 15, 2026 08:45",
      released: "Mar 16, 2026 10:20",
    },
  },
  {
    donationId: "DON-0x1c8e...a3b1",
    amount: "300 XLM",
    recipient: "Nairobi Blood Bank",
    currentStatus: "confirmed" as DonationStatus,
    timestamps: {
      escrow: "Mar 01, 2026 07:30",
      conditions_met: "Mar 05, 2026 12:00",
      released: "Mar 06, 2026 09:15",
      confirmed: "Mar 07, 2026 16:45",
    },
  },
];

export default function DonationLifecyclePage() {
  const [selected, setSelected] = useState(0);

  return (
    <div className="min-h-screen bg-[#F8F8F8] font-poppins p-6 md:p-10">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-[28px] font-bold text-brand-black tracking-[0.03em]">Donation Lifecycle</h1>
          <p className="text-[14px] text-[#5C5B5B] mt-1">
            Track the real-time journey of your contributions on-chain.
          </p>
        </div>

        {/* Donation selector */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          {MOCK_DONATIONS.map((d, i) => (
            <button
              key={d.donationId}
              onClick={() => setSelected(i)}
              className={`flex-1 text-left px-4 py-3 rounded-[12px] border-2 transition-all text-[13px] font-medium
                ${selected === i ? "border-[#D32F2F] bg-red-50 text-[#D32F2F]" : "border-gray-200 bg-white text-[#5C5B5B] hover:border-gray-300"}`}
            >
              <p className="font-semibold truncate">{d.donationId}</p>
              <p className="text-[11px] mt-0.5 opacity-70">{d.amount} · {d.recipient}</p>
            </button>
          ))}
        </div>

        <DonationJourney {...MOCK_DONATIONS[selected]} />

        <div className="mt-12">
          <PledgeForm />
        </div>
      </div>
    </div>
  );
}
