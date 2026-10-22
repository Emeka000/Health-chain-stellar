/**
 * Unified delivery timeline model for correlating cold-chain telemetry
 * and route deviation geo-events (Issue #616).
 */

export type TimelineEventKind =
  | 'TEMPERATURE_SAMPLE'
  | 'ROUTE_DEVIATION_START'
  | 'ROUTE_DEVIATION_END'
  | 'BREACH_START'
  | 'BREACH_END'
  | 'COMPLIANCE_EVALUATED';

export interface TimelineEvent {
  kind: TimelineEventKind;
  /** Normalised wall-clock timestamp (clock-skew adjusted). */
  normalizedAt: Date;
  /** Original source timestamp before normalisation. */
  sourceAt: Date;
  /** Milliseconds of clock-skew correction applied (positive = advanced, negative = delayed). */
  skewMs: number;
  payload: Record<string, unknown>;
}

/** Correlation window linking a breach segment to overlapping deviation incidents. */
export interface CorrelationWindow {
  breachStartAt: Date;
  breachEndAt: Date | null;
  deviationIncidentIds: string[];
  /** Overlap duration in milliseconds (0 when no overlap). */
  overlapMs: number;
  /** Adjudication outcome when signals conflict. */
  adjudication: 'BREACH_DURING_DEVIATION' | 'BREACH_INDEPENDENT' | 'PENDING';
}

/** Persisted evidence bundle for a delivery. */
export interface DeliveryEvidenceBundle {
  deliveryId: string;
  orderId: string | null;
  timeline: TimelineEvent[];
  correlationWindows: CorrelationWindow[];
  /** ISO timestamp of last re-evaluation (e.g. after late-arriving data). */
  lastEvaluatedAt: string;
  /** Whether the bundle is considered final (no more late data expected). */
  finalized: boolean;
}

/** Tolerated clock-skew drift window in milliseconds (30 seconds). */
export const CLOCK_SKEW_TOLERANCE_MS = 30_000;
