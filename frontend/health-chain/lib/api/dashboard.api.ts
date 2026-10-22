/**
 * Typed API functions for Dashboard stats.
 */

import { api } from "./http-client";

const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || "api/v1";

export interface DashboardStats {
  totalBloodUnits: number;
  pendingRequests: number;
  activeDeliveries: number;
  totalDonors: number;
}

/**
 * Fetch aggregated dashboard statistics.
 * Maps to GET /api/v1/dashboard/stats
 *
 * The React Query isError state in the consuming hook should render an error banner
 * if the backend is unreachable.
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  return api.get<DashboardStats>(`/${API_PREFIX}/dashboard/stats`);
}
