/**
 * Schema Breaking-Change Detector
 *
 * Provides semantic diff between two schema snapshots, classifying changes as:
 *   - BREAKING: incompatible mutations (field removed, type changed, required added)
 *   - ADDITIVE: backward-compatible additions (new optional field)
 *   - INFO: informational (no consumer impact)
 *
 * Supports an override mechanism for approved breaking changes.
 */

import { SchemaSnapshot } from './schema-snapshot.matcher';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChangeSeverity = 'BREAKING' | 'ADDITIVE' | 'INFO';

export interface SchemaChange {
  severity: ChangeSeverity;
  path: string;
  description: string;
  /** Human-readable migration note for consumers. */
  migrationNote: string;
}

export interface SchemaDiffResult {
  hasBreakingChanges: boolean;
  changes: SchemaChange[];
  migrationNotes: string[];
  /** True when all breaking changes have an approved override. */
  overrideApproved: boolean;
}

export interface BreakingChangeOverride {
  /** Snapshot name this override applies to. */
  snapshotName: string;
  /** Dot-separated path of the approved breaking change (e.g. "properties.status.type"). */
  path: string;
  /** Maintainer who approved the override. */
  approvedBy: string;
  /** ISO timestamp of approval. */
  approvedAt: string;
  /** Reason for the breaking change. */
  reason: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function diffSchemaNodes(
  oldNode: Record<string, any>,
  newNode: Record<string, any>,
  path: string,
  changes: SchemaChange[],
): void {
  const oldType: string = oldNode?.type ?? 'unknown';
  const newType: string = newNode?.type ?? 'unknown';

  // Type change
  if (oldType !== newType) {
    changes.push({
      severity: 'BREAKING',
      path,
      description: `Type changed from '${oldType}' to '${newType}'`,
      migrationNote: `Consumers reading '${path}' must handle the new type '${newType}' (was '${oldType}'). Update deserialization logic.`,
    });
    return; // No point diffing children if the type changed
  }

  if (oldType === 'object') {
    const oldProps: Record<string, any> = oldNode.properties ?? {};
    const newProps: Record<string, any> = newNode.properties ?? {};
    const oldRequired: string[] = oldNode.required ?? [];
    const newRequired: string[] = newNode.required ?? [];

    // Removed fields
    for (const field of Object.keys(oldProps)) {
      if (!(field in newProps)) {
        changes.push({
          severity: 'BREAKING',
          path: `${path}.${field}`,
          description: `Field '${field}' removed`,
          migrationNote: `Remove all reads of '${path}.${field}' from consumer code. This field no longer exists.`,
        });
      }
    }

    // Added fields
    for (const field of Object.keys(newProps)) {
      if (!(field in oldProps)) {
        const isRequired = newRequired.includes(field);
        if (isRequired) {
          changes.push({
            severity: 'BREAKING',
            path: `${path}.${field}`,
            description: `New required field '${field}' added`,
            migrationNote: `Consumers must now provide '${path}.${field}'. Update all write paths to include this field.`,
          });
        } else {
          changes.push({
            severity: 'ADDITIVE',
            path: `${path}.${field}`,
            description: `New optional field '${field}' added`,
            migrationNote: `'${path}.${field}' is now available. Consumers may optionally use it.`,
          });
        }
      }
    }

    // Required → optional (breaking for strict consumers)
    for (const field of oldRequired) {
      if (!newRequired.includes(field) && field in newProps) {
        changes.push({
          severity: 'BREAKING',
          path: `${path}.${field}`,
          description: `Field '${field}' changed from required to optional`,
          migrationNote: `'${path}.${field}' may now be absent. Add null/undefined guards in consumer code.`,
        });
      }
    }

    // Optional → required (breaking for producers)
    for (const field of newRequired) {
      if (!oldRequired.includes(field) && field in oldProps) {
        changes.push({
          severity: 'BREAKING',
          path: `${path}.${field}`,
          description: `Field '${field}' changed from optional to required`,
          migrationNote: `Producers must now always supply '${path}.${field}'. Update all write paths.`,
        });
      }
    }

    // Recurse into shared fields
    for (const field of Object.keys(oldProps)) {
      if (field in newProps) {
        diffSchemaNodes(oldProps[field], newProps[field], `${path}.${field}`, changes);
      }
    }
  }

  if (oldType === 'array') {
    const oldItems = oldNode.items;
    const newItems = newNode.items;
    if (oldItems && newItems) {
      diffSchemaNodes(oldItems, newItems, `${path}[]`, changes);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute a semantic diff between two schema snapshots.
 *
 * @param oldSnapshot - The previously frozen snapshot (baseline).
 * @param newSnapshot - The current snapshot to compare against.
 * @param overrides   - Approved breaking-change overrides for this snapshot.
 */
export function diffSnapshots(
  oldSnapshot: SchemaSnapshot,
  newSnapshot: SchemaSnapshot,
  overrides: BreakingChangeOverride[] = [],
): SchemaDiffResult {
  const changes: SchemaChange[] = [];

  diffSchemaNodes(oldSnapshot.schema, newSnapshot.schema, oldSnapshot.name, changes);

  const breakingChanges = changes.filter((c) => c.severity === 'BREAKING');
  const migrationNotes = changes
    .filter((c) => c.severity !== 'INFO')
    .map((c) => `[${c.severity}] ${c.path}: ${c.migrationNote}`);

  // Check overrides: a breaking change is covered if there is an approved override
  // matching the snapshot name and path.
  const approvedPaths = new Set(
    overrides
      .filter((o) => o.snapshotName === oldSnapshot.name)
      .map((o) => o.path),
  );

  const unapprovedBreaks = breakingChanges.filter(
    (c) => !approvedPaths.has(c.path),
  );

  return {
    hasBreakingChanges: breakingChanges.length > 0,
    changes,
    migrationNotes,
    overrideApproved: unapprovedBreaks.length === 0,
  };
}

/**
 * Assert that a schema diff has no unapproved breaking changes.
 * Throws with a human-readable message listing all violations.
 */
export function assertNoUnapprovedBreaks(
  result: SchemaDiffResult,
  snapshotName: string,
): void {
  if (result.hasBreakingChanges && !result.overrideApproved) {
    const breakingLines = result.changes
      .filter((c) => c.severity === 'BREAKING')
      .map((c) => `  • ${c.path}: ${c.description}\n    → ${c.migrationNote}`)
      .join('\n');

    throw new Error(
      `Breaking schema changes detected in '${snapshotName}' without approved overrides:\n${breakingLines}\n\n` +
        `To approve, add a BreakingChangeOverride entry with snapshotName='${snapshotName}' and the affected path.`,
    );
  }
}
