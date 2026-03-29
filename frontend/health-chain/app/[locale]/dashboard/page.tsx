'use client';

import React from "react";
import Image from "next/image";
import { Syringe, Clock, Truck, Users, Bell } from "lucide-react";
import { useTranslations } from 'next-intl';

export default function DashboardOverview() {
  const t = useTranslations('Dashboard');
  const commonT = useTranslations('Common');

  const stats = [
    { label: t('stats.bloodUnits'), value: "2,300 Units", icon: Syringe, color: "text-[#D32F2F]", bg: "bg-red-50" },
    { label: t('stats.pendingRequests'), value: "42 Requests", icon: Clock, color: "text-gray-700", bg: "bg-[#F5F5F5]" },
    { label: t('stats.activeDeliveries'), value: "18 Riders", icon: Truck, color: "text-gray-700", bg: "bg-[#F5F5F5]" },
    { label: t('stats.totalDonors'), value: "120", icon: Users, color: "text-gray-700", bg: "bg-[#F5F5F5]" },
  ];

  const criticalRequests = [
    { type: "O+", hospital: "Lagos State Teaching Hospital", time: "2 Minutes Ago", status: "Critical", unit: 5 },
    { type: "A+", hospital: "Lagos State Teaching Hospital", time: "", status: "Urgent", unit: 12 },
    { type: "A-", hospital: "Lagos State Teaching Hospital", time: "", status: "Critical", unit: 15 },
    { type: "A-", hospital: "Lagos State Teaching Hospital", time: "", status: "Critical", unit: 15 },
    { type: "A-", hospital: "Lagos State Teaching Hospital", time: "", status: "Critical", unit: 15 },
    { type: "O-", hospital: "Lagos State Teaching Hospital", time: "", status: "Normal", unit: 5 },
  ];

  return (
    <div className="w-full font-poppins" role="main">
      
      {/* --- HEADER SECTION --- */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-[60px] gap-6 md:gap-0">
        
        {/* Title Text */}
        <div className="flex flex-col gap-[2px]">
            <h1 className="text-[24px] font-bold text-black tracking-[0.05em] leading-[36px]">{t('title')}</h1>
            <p className="text-[12px] font-medium text-[#484646] tracking-[0.05em] leading-[18px]">
                {t('description')}
            </p>
        </div>

        {/* Actions Group: Notification, Button, Profile */}
        <div className="flex items-center gap-[20px]">
            <button 
              className="w-[45px] h-[44px] bg-white rounded-[8px] shadow-[0_4px_13.1px_-4px_rgba(0,0,0,0.25)] flex items-center justify-center relative focus-visible:ring-2 focus-visible:ring-red-500 outline-none"
              aria-label="Notifications"
            >
                <Bell className="w-[21px] h-[23px] text-[#827D7D]" />
                <span className="sr-only">Notifications</span>
            </button>

            <button 
              className="h-[44px] px-[20px] bg-[#D32F2F] rounded-[8px] text-[#F2F3F3] font-poppins font-medium text-[16px] tracking-[0.05em] shadow-sm hover:opacity-90 transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500 outline-none"
              aria-haspopup="dialog"
            >
                {commonT('createRequest')}
            </button>

            <div className="hidden md:block w-[44px] h-[44px] rounded-full overflow-hidden bg-[#D9D9D9] border border-gray-200">
                <Image src="/health-agency.jpg" alt="Admin Profile" width={44} height={44} className="object-cover" />
            </div>
        </div>
      </div>

      {/* --- STATS GRID --- */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-[12px] mb-[40px]" aria-label="Statistics Summary">
        {stats.map((stat, index) => (
          <div key={index} className="bg-white w-full xl:w-[242px] h-[199px] rounded-[24px] shadow-sm flex flex-col justify-center pl-[47px]">
            <div className="flex flex-col gap-[24px]">
                <div 
                  className={`w-[56px] h-[56px] rounded-[12px] flex items-center justify-center ${stat.bg} ${stat.color}`}
                  aria-hidden="true"
                >
                    <stat.icon className="w-[28px] h-[28px]" />
                </div>
                <div>
                    <h2 className="text-[#5C5B5B] font-medium text-[14px] tracking-[0.05em] mb-1">{stat.label}</h2>
                    <p className="text-black font-semibold text-[20px] tracking-[0.05em]">{stat.value}</p>
                </div>
            </div>
          </div>
        ))}
      </section>

      {/* --- Table & Activity --- */}
      <div className="flex flex-col xl:flex-row gap-[16px]">
        
        {/* --- Table --- */}
        <section className="flex-1 bg-white rounded-[12px] shadow-sm p-[30px] min-h-[557px]" aria-labelledby="critical-requests-title">
          <h2 id="critical-requests-title" className="font-bold text-[20px] text-black tracking-[0.05em] mb-[40px]">{t('criticalRequests')}</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th scope="col" className="pb-4 font-bold text-[14px] uppercase tracking-[0.05em] text-black w-[25%]">{t('table.bloodType')}</th>
                  <th scope="col" className="pb-4 font-bold text-[14px] uppercase tracking-[0.05em] text-black w-[40%]">{t('table.hospital')}</th>
                  <th scope="col" className="pb-4 font-bold text-[14px] uppercase tracking-[0.05em] text-black w-[20%]">{t('table.status')}</th>
                  <th scope="col" className="pb-4 font-bold text-[14px] uppercase tracking-[0.05em] text-black text-right w-[15%]">{t('table.unit')}</th>
                </tr>
              </thead>
              <tbody className="space-y-[10px]">
                {criticalRequests.map((row, i) => (
                  <tr key={i} className="bg-[#FAF6F6] h-[62px] border-b-[5px] border-white hover:bg-red-50/30 transition-colors">
                    <td className="pl-4 font-medium text-[16px] text-black">{row.type}</td>
                    <td className="py-2">
                      <div className="font-medium text-[14px] text-black">{row.hospital}</div>
                      {row.time && <div className="text-[10px] text-[#827D7D]">Lagos State - {row.time}</div>}
                    </td>
                    <td className="py-2">
                      <span className={`px-3 py-1 rounded-[4px] text-[10px] font-bold uppercase tracking-[0.05em]
                        ${row.status === "Critical" ? "bg-[#FFE5E5] text-[#D32F2F]" : ""}
                        ${row.status === "Urgent" ? "bg-[#E5F0FF] text-[#007AFF]" : ""}
                        ${row.status === "Normal" ? "bg-[#E5FFEA] text-[#00BFA5]" : ""}
                      `}>
                        {row.status}
                      </span>
                    </td>
                    <td className="pr-4 text-right font-medium text-[18px] text-black">{row.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* --- RECENT ACTIVITY --- */}
        <section className="w-full xl:w-[315px] bg-[#F6F6FA] rounded-[16px] p-[20px] min-h-[466px] relative" aria-labelledby="recent-activity-title">
          <h2 id="recent-activity-title" className="font-bold text-[20px] text-black tracking-[0.05em] mb-[30px]">{t('recentActivity')}</h2>
          
          <div className="space-y-[30px] relative">
            <div className="flex gap-[16px] relative">
               <div className="relative flex flex-col items-center" aria-hidden="true">
                  <div className="w-[12px] h-[12px] rounded-full bg-[#FF7F7F] z-10 shadow-[0_0_0_4px_#FFF]"></div>
                  <div className="w-[2px] h-full bg-[#E0E0E0] absolute top-[12px] left-1/2 -translate-x-1/2"></div>
               </div>
               <div className="pb-4">
                  <h3 className="font-bold text-[14px] text-black">New donor registered</h3>
                  <p className="text-[12px] font-medium text-[#484646] mt-1 leading-[18px]">
                    Sarah Johnson (A+) just signed up in Ikeja.
                  </p>
                  <span className="text-[10px] text-[#827D7D] mt-1 block uppercase">JUST NOW</span>
               </div>
            </div>

             <div className="flex gap-[16px] relative">
               <div className="relative flex flex-col items-center" aria-hidden="true">
                  <div className="w-[12px] h-[12px] rounded-full bg-[#82C3FF] z-10 shadow-[0_0_0_4px_#FFF]"></div>
                  <div className="w-[2px] h-full bg-[#E0E0E0] absolute top-[12px] left-1/2 -translate-x-1/2"></div>
               </div>
               <div className="pb-4">
                  <h4 className="font-bold text-[14px] text-black">Delivery Completed</h4>
                  <p className="text-[12px] font-medium text-[#484646] mt-1 leading-[18px]">
                    Rider #205 delivered 5 units to Abuja Hospital
                  </p>
                  <span className="text-[10px] text-[#827D7D] mt-1 block uppercase">2 HOURS AGO</span>
               </div>
            </div>

             <div className="flex gap-[16px] relative">
               <div className="relative flex flex-col items-center" aria-hidden="true">
                  <div className="w-[12px] h-[12px] rounded-full bg-[#82C3FF] z-10 shadow-[0_0_0_4px_#FFF]"></div>
               </div>
               <div className="pb-4">
                  <h4 className="font-bold text-[14px] text-black">Delivery Completed</h4>
                  <p className="text-[12px] font-medium text-[#484646] mt-1 leading-[18px]">
                     Rider #201 delivered 5 units to London Hospital
                  </p>
                  <span className="text-[10px] text-[#827D7D] mt-1 block uppercase">12 HOURS AGO</span>
               </div>
            </div>
          </div>

          <button 
            className="absolute bottom-[20px] left-[91px] px-[10px] h-[38px] bg-[#EF7676] text-white text-[12px] rounded-[8px] font-medium hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-400 outline-none transition"
            aria-label={t('viewActivityLog')}
          >
            {t('viewActivityLog')}
          </button>
        </section>

      </div>
    </div>
  );
}