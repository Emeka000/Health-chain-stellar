export interface ReconciliationRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
  triggeredBy: string | null;
  totalChecked: number;
  mismatchCount: number;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ReconciliationMismatch {
  id: string;
  runId: string;
  referenceId: string;
  referenceType: string;
  type: 'amount' | 'status' | 'parties' | 'timestamp' | 'proof_ref' | 'missing_on_chain' | 'missing_off_chain';
  severity: 'low' | 'medium' | 'high';
  onChainValue: Record<string, unknown> | null;
  offChainValue: Record<string, unknown> | null;
  resolution: 'pending' | 'resynced' | 'manual' | 'dismissed';
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
}
