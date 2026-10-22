import { UserRole } from '../auth/enums/user-role.enum';

/**
 * Per-role throttle limits (requests per minute).
 *
 * THROTTLE_TTL (env) is interpreted in SECONDS, matching its validated
 * default in env.schema.ts and backend/.env.example. It is converted to
 * milliseconds here because ThrottlerModule conventions used elsewhere in
 * this codebase (see throttler.integration.spec.ts) expect a ms-based ttl.
 * Previously this constant was hardcoded and never read THROTTLE_TTL at
 * all, so the env var had no effect on the actual rate-limit window.
 *
 * ADMIN is granted an effectively unlimited ceiling (Number.MAX_SAFE_INTEGER)
 * so the guard never blocks privileged operations.
 *
 * USSD endpoints are public-facing and USSD-dialled, so they get the
 * tightest limit to mitigate enumeration / abuse from unauth clients.
 */
const THROTTLE_TTL_SECONDS = Number(process.env.THROTTLE_TTL) || 60;
export const THROTTLE_TTL_MS = THROTTLE_TTL_SECONDS * 1000; // 1 minute window by default

export interface RoleThrottleLimit {
  /** Max requests allowed within THROTTLE_TTL_MS */
  limit: number;
  /** Human-readable label used in error messages */
  label: string;
}

type ThrottleRole = UserRole | 'public' | 'ussd';

export const ROLE_THROTTLE_LIMITS: Record<ThrottleRole, RoleThrottleLimit> = {
  [UserRole.ADMIN]: { limit: Number.MAX_SAFE_INTEGER, label: 'Admin' },
  [UserRole.VENDOR]: { limit: 500, label: 'Vendor / Blood Bank' },
  [UserRole.HOSPITAL]: { limit: 200, label: 'Hospital' },
  [UserRole.DONOR]: { limit: 60, label: 'Donor' },
  [UserRole.RIDER]: { limit: 60, label: 'Rider' },
  public: { limit: 30, label: 'Public' },
  ussd: { limit: 10, label: 'USSD' },
};

/** Fallback for unauthenticated requests (no role on req.user). */
export const DEFAULT_THROTTLE_LIMIT: RoleThrottleLimit = {
  limit: 30,
  label: 'Public',
};

/** Tenant-level limits to prevent abuse across organizations */
export interface TenantThrottleLimit {
  /** Max concurrent requests per tenant */
  limit: number;
  /** Human-readable label */
  label: string;
}

export const TENANT_THROTTLE_LIMITS: Record<string, TenantThrottleLimit> = {
  // Default tenant limits - can be overridden per tenant
  default: { limit: 1000, label: 'Default Tenant' },
  // Emergency priority tenants get higher limits
  emergency: { limit: 5000, label: 'Emergency Services' },
};

/** Emergency workflows get higher priority and fairness weight */
export const EMERGENCY_ROLES: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.HOSPITAL,
];
export const EMERGENCY_WEIGHT = 2; // 2x priority for emergency requests

function normalizeThrottleRole(role?: string): ThrottleRole {
  const normalizedRole = role?.trim().toLowerCase();
  if (normalizedRole && normalizedRole in ROLE_THROTTLE_LIMITS) {
    return normalizedRole as ThrottleRole;
  }
  return 'public';
}

export function getEmergencyThrottleWeight(
  role?: string,
  isEmergencyEndpoint = false,
): number {
  const normalizedRole = normalizeThrottleRole(role);
  const isEmergencyRole = EMERGENCY_ROLES.includes(normalizedRole as UserRole);
  return isEmergencyRole || isEmergencyEndpoint ? EMERGENCY_WEIGHT : 1;
}

export function getEffectiveRoleThrottleLimit(
  role?: string,
  isEmergencyEndpoint = false,
): number {
  const normalizedRole = normalizeThrottleRole(role);
  const roleLimit = ROLE_THROTTLE_LIMITS[normalizedRole];
  const weight = getEmergencyThrottleWeight(role, isEmergencyEndpoint);

  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.floor(roleLimit.limit * weight),
  );
}