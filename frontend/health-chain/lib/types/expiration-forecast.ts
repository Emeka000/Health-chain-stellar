export interface ExpiringUnit {
  unitId: string;
  unitCode: string;
  bloodType: string;
  volumeMl: number;
  expiresAt: string;
  hoursRemaining: number;
  organizationId: string;
  organizationName: string | null;
}

export interface ExpirationWindow {
  windowLabel: string;
  hoursMax: number;
  units: ExpiringUnit[];
  totalVolumeMl: number;
}

export type DemandUrgency = 'CRITICAL' | 'URGENT' | 'ROUTINE' | 'SCHEDULED';

export interface TransferRecommendation {
  fromBankId: string;
  fromBankName: string | null;
  toBankId: string;
  toBankName: string | null;
  bloodType: string;
  unitsToTransfer: number;
  urgencyScore: number;
  distanceKm: number | null;
  expiringWithinHours: number;
  demandUrgency: DemandUrgency | null;
}
