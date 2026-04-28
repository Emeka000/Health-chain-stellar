export type SlaStage = 'triage' | 'matching' | 'dispatch_acceptance' | 'pickup' | 'delivery';

export interface SlaStageMetric {
  stage: SlaStage;
  budgetSeconds: number;
  elapsedSeconds: number | null;
  pausedSeconds: number;
  breached: boolean;
  completedAt: string | null;
}

export interface SlaMetrics {
  orderId: string;
  stages: SlaStageMetric[];
}

export interface BreachSummary {
  dimension: string;
  value: string;
  totalOrders: number;
  breachedOrders: number;
  breachRate: number;
  avgElapsedSeconds: number;
}

export interface SlaBreachQuery {
  hospitalId?: string;
  bloodBankId?: string;
  riderId?: string;
  urgencyTier?: string;
  stage?: SlaStage;
  startDate?: string;
  endDate?: string;
}
