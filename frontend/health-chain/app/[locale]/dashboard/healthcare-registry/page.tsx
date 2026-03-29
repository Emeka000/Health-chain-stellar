"use client";
import React, { useState } from "react";
import { ShieldCheck, ExternalLink, ChevronDown, ChevronUp, Star, Activity } from "lucide-react";

interface HealthcareActor {
  id: string;
  name: string;
  type: "Hospital" | "NGO" | "Blood Bank";
  location: string;
  trustScore: number;
  totalDonationsReceived: string;
  activeSince: string;
  contractAddress: string;
  impactStats: { label: string; value: string }[];
  verified: boolean;
}

const ACTORS: HealthcareActor[] = [
  {
    id: "actor-001",
    name: "Lagos General Hospital",
    type: "Hospital",
    location: "Lagos, Nigeria",
    trustScore: 94,
    totalDonationsReceived: "48,200 XLM",
    activeSince: "Jan 2025",
    contractAddress: "GBXYZ...A1B2C3",
    verified: true,
    impactStats: [
      { label: "Patients Served", value: "3,400" },
      { label: "Blood Units Distributed", value: "1,200" },
      { label: "Completed Milestones", value: "28" },
    ],
  },
  {
    id: "actor-002",
    name: "Red Cross Kenya",
    type: "NGO",
    location: "Nairobi, Kenya",
    trustScore: 88,
    totalDonationsReceived: "92,500 XLM",
    activeSince: "Mar 2024",
    contractAddress: "GCABC...D4E5F6",
    verified: true,
    impactStats: [
      { label: "Campaigns Run", value: "14" },
      { label: "Vaccines Delivered", value: "8,700" },
      { label: "Completed Milestones", value: "41" },
    ],
  },
  {
    id: "actor-003",
    name: "Nairobi Blood Bank",
    type: "Blood Bank",
    location: "Nairobi, Kenya",
    trustScore: 76,
    totalDonationsReceived: "21,000 XLM",
    activeSince: "Jun 2025",
    contractAddress: "GDGHI...G7H8I9",
    verified: false,
    impactStats: [
      { label: "Units Stored", value: "540" },
      { label: "Emergency Requests Fulfilled", value: "89" },
      { label: "Completed Milestones", value: "12" },
    ],
  },
];

const TYPE_COLORS: Record<string, string> = {
  Hospital: "bg-blue-50 text-blue-700 border-blue-200",
  NGO: "bg-green-50 text-green-700 border-green-200",
  "Blood Bank": "bg-red-50 text-[#D32F2F] border-red-200",
};

function TrustScoreBadge({ score }: { score: number }) {
  const color = score >= 90 ? "text-green-600" : score >= 75 ? "text-yellow-600" : "text-red-500";
  return (
    <div className="flex items-center gap-1.5">
      <Star size={14} className={color} fill="currentColor" />
      <span className={`text-[13px] font-bold ${color}`}>{score}/100</span>
    </div>
  );
}

function ActorCard({ actor }: { actor: HealthcareActor }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-[20px] shadow-[0px_4px_20px_rgba(0,0,0,0.05)] overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="text-[16px] font-bold text-brand-black truncate">{actor.name}</h3>
              {actor.verified && (
                <ShieldCheck size={16} className="text-[#D32F2F] shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${TYPE_COLORS[actor.type]}`}>
                {actor.type}
              </span>
              <span className="text-[12px] text-[#5C5B5B]">{actor.location}</span>
            </div>
          </div>
          <TrustScoreBadge score={actor.trustScore} />
        </div>

        <div className="grid grid-cols-2 gap-3 mt-5">
          <div className="bg-[#F8F8F8] rounded-[10px] px-4 py-3">
            <p className="text-[11px] text-[#5C5B5B] mb-0.5">Total Received</p>
            <p className="text-[14px] font-bold text-brand-black">{actor.totalDonationsReceived}</p>
          </div>
          <div className="bg-[#F8F8F8] rounded-[10px] px-4 py-3">
            <p className="text-[11px] text-[#5C5B5B] mb-0.5">Active Since</p>
            <p className="text-[14px] font-bold text-brand-black">{actor.activeSince}</p>
          </div>
        </div>

        <div className="flex items-center justify-between mt-5 gap-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-[#D32F2F] hover:opacity-80 transition"
          >
            <Activity size={14} />
            Verify Credential
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <a
            href={`https://stellar.expert/explorer/testnet/contract/${actor.contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-[#5C5B5B] hover:text-brand-black transition"
          >
            <ExternalLink size={12} />
            Explorer
          </a>
        </div>
      </div>

      {/* On-chain metadata panel */}
      {expanded && (
        <div className="border-t border-gray-100 bg-[#FAFAFA] px-6 py-5">
          <p className="text-[11px] font-semibold text-[#5C5B5B] uppercase tracking-wider mb-3">On-Chain Metadata</p>
          <div className="bg-white border border-gray-200 rounded-[10px] px-4 py-3 mb-4">
            <p className="text-[10px] text-[#5C5B5B] mb-1">Soroban Contract Address</p>
            <p className="text-[12px] font-mono font-semibold text-brand-black break-all">{actor.contractAddress}</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {actor.impactStats.map((stat) => (
              <div key={stat.label} className="bg-white border border-gray-100 rounded-[10px] px-3 py-3 text-center">
                <p className="text-[16px] font-bold text-[#D32F2F]">{stat.value}</p>
                <p className="text-[10px] text-[#5C5B5B] mt-0.5 leading-tight">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HealthcareRegistryPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("All");

  const filtered = ACTORS.filter((a) => {
    const matchesSearch = a.name.toLowerCase().includes(search.toLowerCase()) || a.location.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "All" || a.type === filter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="min-h-screen bg-[#F8F8F8] font-poppins p-6 md:p-10">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-[28px] font-bold text-brand-black tracking-[0.03em]">Healthcare Actor Registry</h1>
          <p className="text-[14px] text-[#5C5B5B] mt-1">
            Verified hospitals and NGOs registered on the HealthDonor Protocol.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            type="text"
            placeholder="Search by name or location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-4 py-2.5 rounded-[10px] border border-gray-200 bg-white text-[13px] outline-none focus:border-[#D32F2F] transition"
          />
          <div className="flex gap-2">
            {["All", "Hospital", "NGO", "Blood Bank"].map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`px-4 py-2 rounded-[10px] text-[12px] font-semibold border transition
                  ${filter === t ? "bg-[#D32F2F] text-white border-[#D32F2F]" : "bg-white text-[#5C5B5B] border-gray-200 hover:border-gray-300"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {filtered.length === 0 ? (
            <p className="text-center text-[14px] text-[#5C5B5B] py-12">No actors found.</p>
          ) : (
            filtered.map((actor) => <ActorCard key={actor.id} actor={actor} />)
          )}
        </div>
      </div>
    </div>
  );
}
