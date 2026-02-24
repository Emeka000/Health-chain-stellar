"use client";

import React, { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useRiders } from "@/lib/hooks/useRiders";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Search, MapPin, Star, MoreHorizontal, Users } from "lucide-react";
import { RiderDetailDrawer } from "@/components/riders/RiderDetailDrawer";
import { Rider } from "@/lib/types/riders";

const MOCK_RIDERS: Rider[] = [
  { id: "RID-001", name: "John Doe", phone: "+234 801 234 5678", status: "available", currentZone: "Lagos Island", todayDeliveries: 8, avgRating: 4.8, lastActive: new Date() },
  { id: "RID-002", name: "Sarah Smith", phone: "+234 802 987 6543", status: "on_delivery", currentZone: "Ikeja", todayDeliveries: 5, avgRating: 4.9, lastActive: new Date() },
  { id: "RID-003", name: "Mike Johnson", phone: "+234 803 111 2222", status: "offline", currentZone: "Lekki", todayDeliveries: 0, avgRating: 4.5, lastActive: new Date() }
];

export default function RiderManagementPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { data: apiRiders, isLoading } = useRiders();
  const [searchTerm, setSearchTerm] = useState(searchParams.get("search") || "");
  const [selectedRider, setSelectedRider] = useState<Rider | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const handler = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (searchTerm) params.set("search", searchTerm);
      else params.delete("search");
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm, pathname]);

  const riders = apiRiders || MOCK_RIDERS;
  const filteredRiders = riders.filter(r => 
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.phone.includes(searchTerm)
  );

  return (
    <div className="p-6 lg:p-10 space-y-10 bg-white min-h-screen font-roboto">
      {/* Branded Header */}
      <div className="flex flex-col md:flex-row justify-between items-center border-b border-gray-100 pb-8 gap-4">
        <div className="text-center md:text-left">
          <h1 className="text-[36px] font-manrope font-bold text-brand-black leading-tight">
            Rider Logistics
          </h1>
          <p className="text-[16px] text-gray-500 mt-1">Manage delivery personnel and performance zones.</p>
        </div>
        
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-brand-black transition-colors" size={20} />
          <input 
            type="text"
            placeholder="Search by name or phone..."
            className="pl-12 pr-6 py-3 border-2 border-gray-100 rounded-full w-full md:w-[400px] focus:border-brand-black outline-none transition-all font-medium text-brand-black shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {isLoading && !apiRiders ? (
        <div className="flex flex-col items-center justify-center py-40 gap-4">
          <LoadingSpinner />
          <p className="text-gray-400 font-medium animate-pulse">Syncing logistics data...</p>
        </div>
      ) : (
        <div className="bg-white rounded-[24px] shadow-card border border-gray-50 overflow-hidden">
          <table className="min-w-full">
            <thead className="bg-gray-50/50">
              <tr>
                <th className="px-8 py-5 text-left text-[12px] font-manrope font-bold text-gray-400 uppercase tracking-[0.1em]">Rider Details</th>
                <th className="px-8 py-5 text-left text-[12px] font-manrope font-bold text-gray-400 uppercase tracking-[0.1em]">Status</th>
                <th className="px-8 py-5 text-left text-[12px] font-manrope font-bold text-gray-400 uppercase tracking-[0.1em]">Zone</th>
                <th className="px-8 py-5 text-center text-[12px] font-manrope font-bold text-gray-400 uppercase tracking-[0.1em]">Volume</th>
                <th className="px-8 py-5 text-left text-[12px] font-manrope font-bold text-gray-400 uppercase tracking-[0.1em]">Rating</th>
                <th className="px-8 py-5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredRiders.map(rider => (
                <tr 
                  key={rider.id} 
                  className="hover:bg-gray-50/80 cursor-pointer transition-all group"
                  onClick={() => { setSelectedRider(rider); setIsDrawerOpen(true); }}
                >
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-brand-black flex items-center justify-center text-white font-bold">
                        {rider.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-bold text-brand-black text-[16px]">{rider.name}</div>
                        <div className="text-[13px] text-gray-400">{rider.phone}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <StatusBadge status={rider.status as any} size="sm" />
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-2 text-[14px] font-medium text-gray-600">
                      <MapPin size={16} className="text-[#E22A2A]" />
                      {rider.currentZone}
                    </div>
                  </td>
                  <td className="px-8 py-6 text-center">
                    <span className="inline-block px-3 py-1 bg-gray-100 rounded-full font-bold text-brand-black text-[14px]">
                      {rider.todayDeliveries}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-1.5 font-bold text-brand-black">
                      <Star size={16} className="text-yellow-400 fill-yellow-400" />
                      {rider.avgRating}
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <button className="p-2 text-gray-300 group-hover:text-brand-black transition-colors">
                      <MoreHorizontal size={24} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RiderDetailDrawer 
        rider={selectedRider}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />
    </div>
  );
}