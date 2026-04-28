export type DeviationSeverity = 'minor' | 'moderate' | 'severe';
export type DeviationStatus = 'open' | 'acknowledged' | 'resolved';

export interface RouteDeviationIncident {
  id: string;
  orderId: string;
  riderId: string;
  plannedRouteId: string;
  severity: DeviationSeverity;
  status: DeviationStatus;
  deviationDistanceM: number;
  deviationDurationS: number;
  lastKnownLatitude: number;
  lastKnownLongitude: number;
  reason: string | null;
  recommendedAction: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  scoringApplied: boolean;
  createdAt: string;
}

export interface PlannedRoute {
  id: string;
  orderId: string;
  riderId: string;
  polyline: string;
  corridorRadiusM: number;
  maxDeviationSeconds: number;
  isActive: boolean;
  createdAt: string;
}
