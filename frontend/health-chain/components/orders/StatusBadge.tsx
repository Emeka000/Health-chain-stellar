import React from 'react';
import { Clock, CheckCircle, Truck, CheckCircle2, XCircle, UserCheck, Moon, AlertTriangle } from 'lucide-react';

type AllStatuses = 'pending' | 'confirmed' | 'in_transit' | 'delivered' | 'cancelled' | 'available' | 'on_delivery' | 'offline' | 'suspended';

interface StatusBadgeProps {
  status: AllStatuses;
  size?: 'sm' | 'md' | 'lg';
  isStale?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md', isStale = false }) => {
  const colorClasses: Record<AllStatuses, string> = {
    pending: 'bg-white border-brand-black text-brand-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]',
    confirmed: 'bg-blue-50 border-blue-600 text-blue-700',
    in_transit: 'bg-white border-brand-black text-brand-black',
    delivered: 'bg-white border-brand-black text-brand-black',
    cancelled: 'bg-gray-50 border-gray-300 text-gray-400',
    available: 'bg-white border-brand-black text-brand-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]',
    on_delivery: 'bg-[#E22A2A] border-[#E22A2A] text-white',
    offline: 'bg-gray-100 border-gray-200 text-gray-500',
    suspended: 'bg-black border-black text-white',
  };

  const iconMap: Record<AllStatuses, React.ElementType> = {
    pending: Clock, confirmed: CheckCircle, in_transit: Truck, delivered: CheckCircle2, cancelled: XCircle,
    available: UserCheck, on_delivery: Truck, offline: Moon, suspended: AlertTriangle,
  };

  const StatusIcon = iconMap[status] || AlertTriangle;
  const sizeClasses = { sm: 'px-3 py-1 text-[11px] gap-1.5', md: 'px-4 py-2 text-[13px] gap-2', lg: 'px-5 py-2.5 text-[15px] gap-2.5' };
  
  return (
    <span className={`inline-flex items-center font-manrope font-bold uppercase tracking-wider rounded-full border transition-all ${colorClasses[status]} ${sizeClasses[size]} ${isStale ? 'opacity-50' : ''}`}>
      <StatusIcon size={size === 'sm' ? 12 : 14} />
      {status.replace('_', ' ')}
    </span>
  );
};