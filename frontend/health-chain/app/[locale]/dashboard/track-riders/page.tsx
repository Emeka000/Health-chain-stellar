import React from "react";
import Image from "next/image";
import { Search, Bell } from "lucide-react";

export default function TrackRiders() {
  return (
    <div className="w-full font-poppins text-brand-black max-w-[1600px]">
      
      {/* --- TOP SEARCH BAR --- */}
      <div className="flex justify-between items-center mb-6">
        <div className="relative w-full md:w-[350px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
                type="text" 
                placeholder="Search rider" 
                className="w-full h-[50px] pl-12 pr-4 bg-white rounded-[12px] border border-gray-100 focus:outline-none focus:ring-1 focus:ring-red-500 text-sm"
            />
        </div>
        
        {/* Actions */}
        <div className="hidden md:flex items-center gap-4">
            <button className="w-[45px] h-[44px] bg-white rounded-[8px] shadow-sm flex items-center justify-center">
                <Bell className="w-[20px] h-[20px] text-gray-500" />
            </button>
            <div className="w-[44px] h-[44px] rounded-full overflow-hidden bg-gray-200">
                 <Image src="/health-agency.jpg" alt="Profile" width={44} height={44} className="object-cover" />
            </div>
        </div>
      </div>

      {/* --- MAP SECTION --- */}
      <div className="relative w-full h-[250px] md:h-[350px] lg:h-[400px] rounded-[24px] overflow-hidden mb-8 shadow-sm group">
         
         <div className="absolute inset-0 bg-gray-100">
            <Image 
                src="/map-bg.jpg"
                alt="Live Map" 
                fill 
                className="object-cover object-top opacity-90"
            />
         </div>
         
         {/* OVERLAY CONTROLS */}
         <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur-md pl-4 pr-2 py-2 rounded-[16px] shadow-lg flex items-center gap-6 border border-white">
             
             {/* Live Status Indicators */}
             <div className="flex items-center gap-3">
                 <div className="flex -space-x-3">
                     <div className="w-[30px] h-[30px] rounded-full bg-[#EF7676] border-2 border-white"></div>
                     <div className="w-[30px] h-[30px] rounded-full bg-[#5C9CE0] border-2 border-white"></div>
                     <div className="w-[30px] h-[30px] rounded-full bg-[#C68AF2] border-2 border-white"></div>
                 </div>
                 <span className="text-[12px] font-bold text-black tracking-wide">Live Status</span>
             </div>

             {/* Assign Button */}
             <button className="bg-black text-white px-5 py-3 rounded-[12px] text-[12px] font-bold tracking-wide hover:bg-gray-800 transition">
                 Assign New Rider
             </button>
         </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-8">
          
          {/* --- LEFT: ACTIVE DELIVERIES --- */}
          <div className="flex-1">
              <h3 className="font-bold text-[14px] uppercase tracking-wider text-[#827D7D] mb-6">Active Deliveries (5)</h3>
              
              <div className="space-y-4">
                  {/* Rider Card 1 */}
                  <div className="bg-white p-4 rounded-[16px] shadow-sm flex items-center justify-between border border-gray-50 hover:shadow-md transition">
                      <div className="flex items-center gap-4">
                          <div className="w-[50px] h-[50px] rounded-full bg-[#D9D9D9]"></div>
                          <div>
                              <h4 className="font-bold text-[16px] text-black">John O.</h4>
                              <p className="text-[12px] text-[#827D7D]">ID: #221</p>
                          </div>
                      </div>
                      <span className="px-4 py-2 bg-[#FFE5E5] text-[#D32F2F] text-[10px] font-bold rounded-[8px] uppercase tracking-wider">Enroute</span>
                  </div>

                  {/* Rider Card 2 */}
                  <div className="bg-white p-4 rounded-[16px] shadow-sm flex items-center justify-between border border-gray-50 hover:shadow-md transition">
                      <div className="flex items-center gap-4">
                          <div className="w-[50px] h-[50px] rounded-full bg-[#D9D9D9]"></div>
                          <div>
                              <h4 className="font-bold text-[16px] text-black">Christopher A.</h4>
                              <p className="text-[12px] text-[#827D7D]">ID: #221</p>
                          </div>
                      </div>
                      <span className="px-4 py-2 bg-[#E5F0FF] text-[#5C9CE0] text-[10px] font-bold rounded-[8px] uppercase tracking-wider">Picking Up</span>
                  </div>

                   {/* Rider Card 3 */}
                   <div className="bg-white p-4 rounded-[16px] shadow-sm flex items-center justify-between border border-gray-50 hover:shadow-md transition">
                      <div className="flex items-center gap-4">
                          <div className="w-[50px] h-[50px] rounded-full bg-[#D9D9D9]"></div>
                          <div>
                              <h4 className="font-bold text-[16px] text-black">Judith Q.</h4>
                              <p className="text-[12px] text-[#827D7D]">ID: #221</p>
                          </div>
                      </div>
                      <span className="px-4 py-2 bg-[#E5F0FF] text-[#5C9CE0] text-[10px] font-bold rounded-[8px] uppercase tracking-wider">Picking Up</span>
                  </div>
              </div>
          </div>

          {/* --- RIGHT: DELIVERY DETAILS --- */}
          <div className="w-full xl:w-[400px] h-fit">
              <h3 className="font-bold text-[14px] uppercase tracking-wider text-[#827D7D] mb-2">Delivery Details</h3>
              <p className="text-[12px] text-[#827D7D] mb-6">Order: #2026-223</p>

              {/* Units Banner */}
              <div className="bg-[#FFE5E5] p-6 rounded-[20px] flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                      <div className="w-[45px] h-[45px] bg-[#1E1E1E] text-white rounded-[8px] flex items-center justify-center font-bold text-[18px]">O+</div>
                      <div>
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Units Requested</p>
                          <h4 className="text-[20px] font-bold text-black">5 Units</h4>
                      </div>
                  </div>
                  <span className="bg-[#D32F2F] text-white px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide">CRITICAL</span>
              </div>

              {/* Rider Timeline */}
              <h3 className="font-bold text-[14px] uppercase tracking-wider text-black mb-6">Rider Timeline</h3>
              <div className="border-l-[3px] border-gray-200 ml-2 space-y-10 pl-8 relative pb-2 pt-2">
                  
                  {/* Step 1 */}
                  <div className="relative">
                      <div className="absolute -left-[38px] top-1 w-[14px] h-[14px] rounded-full bg-gray-300 ring-4 ring-white"></div>
                      <span className="text-[10px] text-[#827D7D] block mb-1">Pickup location</span>
                      <h4 className="font-bold text-[16px] text-black leading-tight">Ikeja General Hospital</h4>
                      <p className="text-[10px] text-[#827D7D] mt-1">Collected at 12:30AM</p>
                  </div>

                  {/* Step 2 */}
                  <div className="relative">
                      <div className="absolute -left-[38px] top-1 w-[14px] h-[14px] rounded-full bg-[#D32F2F] ring-4 ring-white"></div>
                      <span className="text-[10px] text-[#D32F2F] font-bold block mb-1">In transit</span>
                      <h4 className="font-bold text-[16px] text-black leading-tight">3rd Mainland Bridge</h4>
                      <p className="text-[10px] text-[#827D7D] mt-1">Estimated Arrival: 7:10AM</p>
                  </div>

                  {/* Step 3 */}
                  <div className="relative">
                      <div className="absolute -left-[38px] top-1 w-[14px] h-[14px] rounded-full bg-[#E5FFEA] ring-4 ring-white"></div>
                      <span className="text-[10px] text-[#00BFA5] block mb-1">Destination</span>
                      <h4 className="font-bold text-[16px] text-black leading-tight">Ikeja General Hospital</h4>
                      <p className="text-[10px] text-[#827D7D] mt-1">Pending</p>
                  </div>
              </div>

              {/* Dispatcher */}
              <h3 className="font-bold text-[14px] uppercase tracking-wider text-black mt-10 mb-4">Dispatcher</h3>
              <div className="border border-gray-200 rounded-[16px] p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                      <div className="w-[45px] h-[45px] rounded-full bg-[#D9D9D9]"></div>
                      <div>
                          <h4 className="font-bold text-[14px] text-black">John O.</h4>
                          <p className="text-[10px] text-[#827D7D]">ID: #221</p>
                      </div>
                  </div>
                  <button className="bg-black text-white text-[10px] font-bold px-4 py-2 rounded-[8px] tracking-wide">PING RIDER</button>
              </div>

          </div>
      </div>
    </div>
  );
}