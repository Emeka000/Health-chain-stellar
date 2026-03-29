"use client";
import React from "react";
import { KPICards } from "@/components/dashboard/KPICards";
import { LiveOpsMap } from "@/components/dashboard/LiveOpsMap";
import { InventoryHeatmap } from "@/components/dashboard/InventoryHeatmap";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { useDashboardData } from "@/lib/hooks/useDashboardData";

export default function AdminDashboardPage() {
  const { data, isConnected } = useDashboardData();

  return (
    <div className="p-6 lg:p-10 space-y-10 bg-white min-h-screen font-roboto">
      {/* Header with MDrips Styling */}
      <div className="flex flex-col md:flex-row justify-between items-center border-b border-gray-100 pb-8 gap-4">
        <div className="text-center md:text-left">
          <h1 className="text-[36px] font-manrope font-bold text-brand-black leading-tight">
            Operations Center
          </h1>
          <p className="text-[16px] text-gray-500 mt-1">
            Real-time monitoring of hope and healing.
          </p>
        </div>
        
        <div className="flex items-center gap-4">
           {/* Status Indicator styled like MDrips buttons */}
          <div className={`px-6 py-2 rounded-full text-[14px] font-bold border-2 flex items-center gap-3 transition-all ${
            isConnected 
            ? 'bg-white border-brand-black text-brand-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' 
            : 'bg-gray-100 border-gray-300 text-gray-400'
          }`}>
            <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-[#E22A2A] animate-pulse' : 'bg-gray-400'}`} />
            {isConnected ? 'LIVE FEED ACTIVE' : 'SYSTEM OFFLINE'}
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <KPICards data={data?.kpis} />

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-10">
        {/* Map styled with MDrips circular shadow logic */}
        <div className="xl:col-span-3 h-[600px] bg-white rounded-[24px] shadow-card border-[6px] border-white overflow-hidden relative">
          <LiveOpsMap />
        </div>
        
        {/* Activity Feed */}
        <div className="xl:col-span-1 h-[600px]">
          <ActivityFeed events={data?.events} />
        </div>
      </div>

      {/* Inventory Heatmap Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 pb-20">
        <InventoryHeatmap data={data?.inventory} />
        
        {/* Call to Action Box - Matches Collaborator Cards */}
        <div className="relative rounded-xl overflow-hidden shadow-card bg-brand-black p-8 flex flex-col justify-center text-white">
          <h3 className="font-manrope font-bold text-[28px] mb-4">Urgent Action Required</h3>
          <p className="font-roboto text-[16px] opacity-80 mb-8 leading-relaxed">
            There are 3 hospitals in the Lagos Island zone currently below 10% stock for O- Blood types. 
            Dispatch nearest riders?
          </p>
          <button className="bg-brand-requestBtn text-white w-full md:w-[200px] h-[50px] rounded font-roboto font-semibold text-[16px] hover:brightness-110 transition-all">
            Open Logistics
          </button>
        </div>
      </div>
    </div>
  );
}