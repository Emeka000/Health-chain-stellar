/**
 * Fine-grained permission scope model (Issue #619).
 *
 * A scope is a structured qualifier: action:resource[:context]
 * Wildcards (*) are supported at any segment.
 *
 * Precedence (highest → lowest):
 *   1. Explicit DENY  — always wins
 *   2. Explicit ALLOW — wins over inherited
 *   3. Inherited ALLOW — from role hierarchy
 */

export type ScopeEffect = 'ALLOW' | 'DENY';

export interface ScopeGrant {
  /** e.g. "create:order", "view:*", "*:*" */
  scope: string;
  effect: ScopeEffect;
  /** Optional org/tenant boundary. Null = global. */
  orgId: string | null;
  /** Whether this grant was inherited from a parent role. */
  inherited: boolean;
}

export interface ScopeEvaluationContext {
  userId: string;
  role: string;
  orgId: string | null;
  /** Additional grants beyond the role's base set (e.g. user-level overrides). */
  extraGrants?: ScopeGrant[];
}

/** One step in the decision trace explaining why access was granted/denied. */
export interface DecisionTraceStep {
  scope: string;
  effect: ScopeEffect;
  matchedGrant: ScopeGrant;
  reason: string;
}

export interface ScopeDecision {
  allowed: boolean;
  /** Ordered trace of matching grants that led to the decision. */
  trace: DecisionTraceStep[];
}
