export const InventoryHeatmap = ({ data }: { data?: any[] }) => {
  return (
    <div className="bg-white p-8 rounded-xl shadow-card border border-gray-50">
      <h2 className="font-manrope font-bold text-[24px] text-brand-black mb-8">
        Blood Stock Urgency
      </h2>
      <div className="grid grid-cols-4 gap-4">
        {data?.map((item) => {
          const isCritical = item.level < 20;
          return (
            <div key={item.type} className="flex flex-col items-center">
              <div className={`w-full h-16 rounded flex items-center justify-center font-bold text-[18px] transition-all ${
                isCritical 
                ? 'bg-[#E22A2A] text-white shadow-lg' 
                : 'bg-gray-100 text-brand-black'
              }`}>
                {item.type}
              </div>
              <span className={`mt-2 font-roboto font-bold text-[14px] ${isCritical ? 'text-[#E22A2A]' : 'text-gray-400'}`}>
                {item.level}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};