export enum EscalationTier {
  NONE = 'NONE',
  TIER_1 = 'TIER_1', // Urgent + low inventory
  TIER_2 = 'TIER_2', // Critical urgency or near-SLA breach
  TIER_3 = 'TIER_3', // Critical + no inventory / SLA breached
}
