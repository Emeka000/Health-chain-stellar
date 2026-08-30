import { api } from './http-client';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export interface SurgeSimulationRequest {
  surgeDemandUnits: number;
  overrideStockUnits?: number;
  overrideRiderCapacityUnits?: number;
  unitsPerRider?: number;
}

export interface SurgeSimulationResult {
  surgeDemandUnits: number;
  baselineStockUnits: number;
  riderCapacityUnits: number;
  unitsPerRiderAssumption: number;
  activeRidersConsidered: number;
  stockGapUnits: number;
  riderGapUnits: number;
  canAbsorbWithStock: boolean;
  canAbsorbWithRiders: boolean;
  summary: string;
}

export const runSurgeSimulation = (body: SurgeSimulationRequest) =>
  api.post<SurgeSimulationResult>(`/${PREFIX}/operations/surge-simulation`, body, {
    skipAuth: true,
  });

export interface DashboardKPIs {
  activeOrders: number;
  availableRiders: number;
  criticalAlerts: number;
  deliveredToday: number;
}

export interface DashboardEvent {
  id: string;
  type: string;
  message: string;
  timestamp: string;
}

export interface DashboardInventoryLevel {
  type: string;
  level: number;
}

export interface OperationsDashboardData {
  kpis: DashboardKPIs;
  events: DashboardEvent[];
  inventory: DashboardInventoryLevel[];
}

export const fetchOperationsDashboard = () =>
  api.get<OperationsDashboardData>(`/${PREFIX}/operations/dashboard`);
