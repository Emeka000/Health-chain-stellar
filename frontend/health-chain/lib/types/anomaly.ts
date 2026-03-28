export type AnomalyType =
  | 'DUPLICATE_EMERGENCY_REQUEST'
  | 'RIDER_ROUTE_DEVIATION'
  | 'REPEATED_ESCROW_DISPUTE'
  | 'SUDDEN_STOCK_SWING';

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export type AnomalyStatus = 'OPEN' | 'INVESTIGATING' | 'DISMISSED' | 'RESOLVED';

export interface AnomalyIncident {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  status: AnomalyStatus;
  description: string;
  orderId: string | null;
  riderId: string | null;
  hospitalId: string | null;
  bloodRequestId: string | null;
  metadata: Record<string, unknown> | null;
  reviewNotes: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnomaliesResponse {
  data: AnomalyIncident[];
  pagination: {
    currentPage: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface AnomalyQueryParams {
  type?: AnomalyType;
  severity?: AnomalySeverity;
  status?: AnomalyStatus;
  page?: number;
  pageSize?: number;
}

export interface ReviewAnomalyPayload {
  status: AnomalyStatus;
  reviewNotes?: string;
}
