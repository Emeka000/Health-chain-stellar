"use client";
import React from "react";

// MAKE SURE THE WORD 'export' IS HERE
export const KPICards = ({ data }: { data?: any }) => {
  const stats = [
    { label: "Active Orders", value: data?.activeOrders, color: "text-brand-black" },
    { label: "Riders Online", value: data?.availableRiders, color: "text-brand-black" },
    { label: "Urgent Alerts", value: data?.criticalAlerts, color: "text-[#E22A2A]" }, 
    { label: "Saved Today", value: data?.deliveredToday, color: "text-brand-black" },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
      {stats.map((stat, i) => (
        <div key={i} className="flex flex-col items-center md:items-start group">
          <div className="relative w-[100px] h-[100px] bg-white rounded-full flex items-center justify-center border-2 border-brand-black shadow-[0px_4px_10px_2px_rgba(165,164,164,0.3)] mb-4 transition-transform group-hover:scale-105">
            <span className={`font-manrope font-bold text-[32px] ${stat.color}`}>
              {data ? stat.value : "0"}
            </span>
          </div>
          <p className="font-manrope font-bold text-[18px] text-brand-black uppercase tracking-wide">
            {stat.label}
          </p>
        </div>
      ))}
    </div>
  );
};