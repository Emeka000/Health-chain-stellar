/** Canonical urgency enum used by the priority queue system. */
export enum RequestUrgency {
  CRITICAL = 'CRITICAL',
  URGENT = 'URGENT',
  ROUTINE = 'ROUTINE',
  SCHEDULED = 'SCHEDULED',
}

/** SLA windows in milliseconds per urgency level. */
export const SLA_WINDOWS_MS: Record<RequestUrgency, number> = {
  [RequestUrgency.CRITICAL]: 15 * 60 * 1000,   // 15 min
  [RequestUrgency.URGENT]:   2 * 60 * 60 * 1000, // 2 h
  [RequestUrgency.ROUTINE]:  8 * 60 * 60 * 1000, // 8 h
  [RequestUrgency.SCHEDULED]: 72 * 60 * 60 * 1000, // 72 h
};

/** BullMQ numeric priority — lower number = higher priority. */
export const QUEUE_PRIORITY: Record<RequestUrgency, number> = {
  [RequestUrgency.CRITICAL]: 1,
  [RequestUrgency.URGENT]:   5,
  [RequestUrgency.ROUTINE]:  10,
  [RequestUrgency.SCHEDULED]: 20,
};

/**
 * Resolve the BullMQ priority for an urgency, failing loudly when the urgency
 * is not mapped instead of silently enqueueing an undefined priority.
 */
export function resolveQueuePriority(urgency: RequestUrgency): number {
  const priority = QUEUE_PRIORITY[urgency];
  if (priority === undefined) {
    throw new Error(`No queue priority mapped for urgency: ${urgency}`);
  }
  return priority;
}

/**
 * Resolve the SLA window (ms) for an urgency, failing loudly when the urgency
 * is not mapped instead of silently comparing against undefined.
 */
export function resolveSlaWindowMs(urgency: RequestUrgency): number {
  const windowMs = SLA_WINDOWS_MS[urgency];
  if (windowMs === undefined) {
    throw new Error(`No SLA window mapped for urgency: ${urgency}`);
  }
  return windowMs;
}

export const BLOOD_REQUEST_QUEUE = 'blood-requests';
