export interface DashboardKPIs {
  activeOrders: number;
  availableRiders: number;
  criticalAlerts: number;
  deliveriesToday: number;
}

export interface InventoryStatus {
  bloodType: string;
  region: string;
  stockLevel: number; // 0-100
  status: 'critical' | 'low' | 'stable';
}

export interface LiveEvent {
  id: string;
  type: 'order_placed' | 'rider_assigned' | 'delivery_confirmed' | 'inventory_alert';
  message: string;
  timestamp: string;
}