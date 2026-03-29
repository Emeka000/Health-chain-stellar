/**
 * Per-role throttle limits (requests per minute).
 *
 * TTL is expressed in milliseconds to match ThrottlerModule conventions
 * used elsewhere in this codebase (see throttler.integration.spec.ts).
 *
 * ADMIN is granted an effectively unlimited ceiling (Number.MAX_SAFE_INTEGER)
 * so the guard never blocks privileged operations.
 *
 * USSD endpoints are public-facing and USSD-dialled, so they get the
 * tightest limit to mitigate enumeration / abuse from unauth clients.
 */
export const THROTTLE_TTL_MS = 60_000; // 1 minute window

export interface RoleThrottleLimit {
  /** Max requests allowed within THROTTLE_TTL_MS */
  limit: number;
  /** Human-readable label used in error messages */
  label: string;
}

export const ROLE_THROTTLE_LIMITS: Record<string, RoleThrottleLimit> = {
  ADMIN: { limit: Number.MAX_SAFE_INTEGER, label: 'Admin' },
  BLOOD_BANK: { limit: 500, label: 'Blood Bank' },
  HOSPITAL: { limit: 200, label: 'Hospital' },
  DONOR: { limit: 60, label: 'Donor' },
  PUBLIC: { limit: 30, label: 'Public' },
  USSD: { limit: 10, label: 'USSD' },
} as const;

/** Fallback for unauthenticated requests (no role on req.user). */
export const DEFAULT_THROTTLE_LIMIT: RoleThrottleLimit = {
  limit: 30,
  label: 'Public',
};