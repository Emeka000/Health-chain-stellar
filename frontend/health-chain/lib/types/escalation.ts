export type EscalationTier = 'TIER_1' | 'TIER_2' | 'TIER_3';

export interface Escalation {
  id: string;
  requestId: string;
  orderId: string | null;
  hospitalId: string;
  tier: EscalationTier;
  slaDeadlineMs: number;
  riderId: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
}
