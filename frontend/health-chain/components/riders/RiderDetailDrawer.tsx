"use client";

import React from "react";
import { X, MapPin, Star, Clock, ShieldAlert, MessageSquare, RefreshCw } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { Rider, RiderPerformance } from "@/lib/types/riders";
import { StatusBadge } from "../orders/StatusBadge";

interface RiderDetailDrawerProps {
  rider: Rider | null;
  isOpen: boolean;
  onClose: () => void;
  performanceData?: RiderPerformance[];
}

const MOCK_PERFORMANCE = [
  { date: "Mon", deliveries: 12, rating: 4.8 },
  { date: "Tue", deliveries: 15, rating: 4.9 },
  { date: "Wed", deliveries: 8, rating: 4.5 },
  { date: "Thu", deliveries: 14, rating: 4.7 },
  { date: "Fri", deliveries: 19, rating: 5.0 },
];

export const RiderDetailDrawer: React.FC<RiderDetailDrawerProps> = ({ rider, isOpen, onClose, performanceData = MOCK_PERFORMANCE }) => {
  if (!rider) return null;

  return (
    <>
      <div className={`fixed inset-0 bg-brand-black/40 backdrop-blur-sm transition-opacity z-40 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <div className={`fixed right-0 top-0 h-full w-full md:w-[550px] bg-white shadow-2xl z-50 transform transition-transform duration-500 ease-in-out overflow-y-auto ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        
        <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h2 className="text-[28px] font-manrope font-bold text-brand-black leading-tight">{rider.name}</h2>
            <p className="text-[14px] text-gray-500 font-medium">Internal ID: {rider.id}</p>
          </div>
          <button onClick={onClose} className="w-12 h-12 flex items-center justify-center border-2 border-brand-black rounded-full hover:bg-brand-black hover:text-white transition-all">
            <X size={24} />
          </button>
        </div>

        <div className="p-8 space-y-10 font-roboto">
          <div className="grid grid-cols-2 gap-6">
            <div className="p-6 bg-white rounded-xl border border-gray-100 shadow-card flex flex-col items-center text-center">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Status</span>
              <StatusBadge status={rider.status} size="sm" />
            </div>
            <div className="p-6 bg-white rounded-xl border border-gray-100 shadow-card flex flex-col items-center text-center">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Today</span>
              <span className="text-[24px] font-black text-brand-black">{rider.todayDeliveries}</span>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-card">
            <h3 className="font-manrope font-bold text-[18px] text-brand-black mb-6 flex items-center gap-2">
              <Clock size={20} className="text-[#E22A2A]" /> Delivery Volume
            </h3>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceData}>
                  <XAxis dataKey="date" fontSize={11} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)'}} />
                  <Bar dataKey="deliveries" fill="#000000" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block text-[14px] font-bold text-brand-black uppercase tracking-wider">Zone Management</label>
            <div className="flex gap-3">
              <select className="flex-1 h-[50px] bg-gray-50 border-2 border-gray-100 rounded-lg px-4 font-medium outline-none focus:border-brand-black transition-all">
                <option>{rider.currentZone}</option>
                <option>Lagos Mainland</option>
                <option>Lekki/Ajah</option>
              </select>
              <button className="bg-brand-requestBtn text-white px-8 rounded-lg font-bold text-[14px] hover:brightness-110">Update</button>
            </div>
          </div>

          <div className="pt-8 border-t border-gray-100 space-y-3">
            <button className="w-full h-[55px] bg-brand-black text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all">
              <MessageSquare size={18} /> Contact Rider
            </button>
            <button className="w-full h-[55px] border-2 border-[#E22A2A] text-[#E22A2A] rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-[#E22A2A] hover:text-white transition-all">
              <ShieldAlert size={18} /> Suspend Account
            </button>
          </div>
        </div>
      </div>
    </>
  );
};