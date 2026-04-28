/** Canonical urgency enum used by the priority queue system. */
export enum RequestUrgency {
  CRITICAL = 'CRITICAL',
  URGENT = 'URGENT',
  ROUTINE = 'ROUTINE',
}

/** SLA windows in milliseconds per urgency level. */
export const SLA_WINDOWS_MS: Record<RequestUrgency, number> = {
  [RequestUrgency.CRITICAL]: 15 * 60 * 1000,   // 15 min
  [RequestUrgency.URGENT]:   2 * 60 * 60 * 1000, // 2 h
  [RequestUrgency.ROUTINE]:  8 * 60 * 60 * 1000, // 8 h
};

/** BullMQ numeric priority — lower number = higher priority. */
export const QUEUE_PRIORITY: Record<RequestUrgency, number> = {
  [RequestUrgency.CRITICAL]: 1,
  [RequestUrgency.URGENT]:   5,
  [RequestUrgency.ROUTINE]:  10,
};

export const BLOOD_REQUEST_QUEUE = 'blood-requests';
