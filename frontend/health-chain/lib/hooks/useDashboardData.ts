import { useState, useEffect } from 'react';

export function useDashboardData() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    setData({
      kpis: { activeOrders: 12, availableRiders: 8, criticalAlerts: 3, deliveredToday: 45 },
      events: [
        { id: '1', type: 'order_placed', message: 'New order #ORD-99 from St. Jude', timestamp: 'Just now' },
        { id: '2', type: 'rider_assigned', message: 'Rider John assigned to #ORD-92', timestamp: '2m ago' }
      ],
      inventory: [
        { type: 'O+', level: 85 }, { type: 'O-', level: 12 }, { type: 'A+', level: 60 }, { type: 'A-', level: 25 },
        { type: 'B+', level: 90 }, { type: 'B-', level: 40 }, { type: 'AB+', level: 75 }, { type: 'AB-', level: 15 }
      ]
    });
  }, []);

  return { data, isConnected: true };
}