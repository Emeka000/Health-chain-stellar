import { Clock } from "lucide-react";

export const ActivityFeed = ({ events }: { events?: any[] }) => {
  return (
    <div className="bg-white h-full rounded-[24px] shadow-card border border-gray-100 flex flex-col overflow-hidden">
      <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
        <h3 className="font-manrope font-bold text-[18px] text-brand-black uppercase tracking-tight">Real-time Activity</h3>
        <div className="w-2 h-2 rounded-full bg-[#E22A2A] animate-pulse" />
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
        {events?.map((event) => (
          <div key={event.id} className="relative pl-6 border-l-2 border-gray-100 group">
            <div className="absolute left-[-5px] top-1.5 w-2 h-2 rounded-full bg-brand-black group-hover:bg-[#E22A2A] transition-colors" />
            <p className="font-roboto font-semibold text-[14px] text-brand-black leading-snug">
              {event.message}
            </p>
            <div className="flex items-center gap-1 mt-1 font-roboto text-[12px] text-gray-400">
              <Clock size={12} /> {event.timestamp}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};