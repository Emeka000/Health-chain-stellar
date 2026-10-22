/**
 * RBAC Coverage — drift-prevention test
 *
 * This test fails whenever a `Permission` enum value is not granted to at least
 * one role by the migration seed files.  It catches the class of bugs described
 * in issue #1548 where new permissions are added to the enum but the
 * corresponding `INSERT INTO role_permissions` is never written, leaving every
 * endpoint guarded by that permission returning 403 for all users.
 *
 * HOW IT WORKS
 * ────────────
 * Rather than spinning up a real database, this test runs the `up()` method of
 * every RBAC migration against a lightweight mock QueryRunner that intercepts
 * all `INSERT INTO role_permissions` calls and records the permission string
 * passed as the first parameter.
 *
 * The collected set is then compared against `Object.values(Permission)`.  Any
 * enum value missing from the set (and not listed in KNOWN_UNGRANTED) fails the
 * test with a descriptive message that lists each ungranted permission.
 *
 * Known gaps (permissions that exist in the enum but are not yet seeded) are
 * listed in KNOWN_UNGRANTED.  Those are asserted separately and will fail once
 * the gap is fixed, prompting the developer to remove the entry and write a
 * migration.
 *
 * HOW TO FIX A FAILURE
 * ────────────────────
 * 1. Write a new migration that grants the missing permission to at least one
 *    role (see docs/rbac.md — "Adding or Changing a Grant").
 * 2. Import the new migration class in the `MIGRATIONS` array below.
 * 3. Remove the permission from KNOWN_UNGRANTED (if it was listed there).
 * 4. Update docs/rbac.md to reflect the new grant.
 */

import { CreateRbacTables1708000001000 } from '../../migrations/1708000001000-CreateRbacTables';
import { AddFineGrainedPermissionScopes1820000002000 } from '../../migrations/1820000002000-AddFineGrainedPermissionScopes';
import { Permission } from '../enums/permission.enum';

// ─── Migration registry ────────────────────────────────────────────────────
//
// Add every migration that touches `role_permissions` here, in chronological
// order.  The test re-runs all of them on every test run so the final granted
// set always reflects the complete migration history.
//
const MIGRATIONS = [
  new CreateRbacTables1708000001000(),
  new AddFineGrainedPermissionScopes1820000002000(),
];

// ─── Known gaps (issue #1548) ──────────────────────────────────────────────
//
// These permissions exist in the enum but are not yet seeded to any role.
// They are excluded from the hard coverage-gate below so the gate only fails
// for *new* ungranted permissions introduced after this PR.
//
// When you fix a gap:
//   1. Write a migration that grants the permission.
//   2. Add the migration to MIGRATIONS above.
//   3. Remove the entry from this set.
//   4. Update docs/rbac.md.
//
const KNOWN_UNGRANTED_WIRE_VALUES = new Set<string>([
  'record:location', // Permission.RECORD_LOCATION      — rider
  'view:location-history', // Permission.VIEW_LOCATION_HISTORY — admin, rider
  'update:blood-status', // Permission.UPDATE_BLOOD_STATUS   — vendor, hospital
  'view:blood-status-history', // Permission.VIEW_BLOOD_STATUS_HISTORY
  'read:analytics', // Permission.READ_ANALYTICS        — admin
  'export:disputes', // Permission.EXPORT_DISPUTES       — admin
  'view:blood-requests', // Permission.VIEW_BLOOD_REQUESTS   — admin, hospital
  'download:reports', // Permission.DOWNLOAD_REPORTS      — admin
  'MANAGE_FEE_POLICIES', // Permission.MANAGE_FEE_POLICIES   — admin
  'VIEW_FEE_POLICIES', // Permission.VIEW_FEE_POLICIES     — admin, hospital
  'view:reputation', // Permission.VIEW_REPUTATION       — admin, rider, hospital
  'manage:reputation', // Permission.MANAGE_REPUTATION     — admin
]);

// ─── Mock QueryRunner ──────────────────────────────────────────────────────

/**
 * Minimal QueryRunner stub.  Only `query()` needs real behaviour — everything
 * else is a no-op.  The stub captures every permission value passed to an
 * INSERT on role_permissions.
 */
function buildMockQueryRunner() {
  const grantedPermissions = new Set<string>();

  const queryRunner = {
    // ── Recorded state ──────────────────────────────────────────────────
    grantedPermissions,

    // ── Table DDL stubs (no-ops) ─────────────────────────────────────────
    createTable: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined),
    createIndex: jest.fn().mockResolvedValue(undefined),
    dropIndex: jest.fn().mockResolvedValue(undefined),
    createForeignKey: jest.fn().mockResolvedValue(undefined),
    dropForeignKey: jest.fn().mockResolvedValue(undefined),

    /**
     * Intercepts SQL queries.
     *
     * Role seed INSERTs (`INSERT INTO roles`) are ignored — we only care about
     * `INSERT INTO role_permissions`.  The first positional parameter ($1) of
     * those inserts is always the permission string.
     */
    query: jest.fn().mockImplementation((sql: string, params?: unknown[]) => {
      const normalised = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (
        normalised.includes('insert into role_permissions') &&
        Array.isArray(params) &&
        params.length >= 1
      ) {
        // For migration 1 the signature is (permission, …) — $1 is the permission.
        // For migration 2 the signature is (permission, role) — $1 is also the permission.
        grantedPermissions.add(params[0] as string);
      }

      return Promise.resolve([]);
    }),
  };

  return queryRunner;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('RBAC coverage — no Permission enum value may be ungranted', () => {
  let grantedPermissions: Set<string>;

  beforeAll(async () => {
    const runner = buildMockQueryRunner();

    // Run every registered migration in order
    for (const migration of MIGRATIONS) {
      await migration.up(runner as any);
    }

    grantedPermissions = runner.grantedPermissions;
  });

  it('grants every Permission enum value to at least one role (known gaps excluded)', () => {
    const allPermissions = Object.entries(Permission) as [string, string][];

    // Exclude permissions that are documented as known gaps in KNOWN_UNGRANTED_WIRE_VALUES.
    // This test only fails for *new* ungranted permissions introduced after this PR.
    const newUngranted = allPermissions.filter(
      ([, wireValue]) =>
        !grantedPermissions.has(wireValue) &&
        !KNOWN_UNGRANTED_WIRE_VALUES.has(wireValue),
    );

    if (newUngranted.length === 0) {
      return;
    }

    const lines = newUngranted.map(
      ([enumKey, wireValue]) =>
        `  • Permission.${enumKey} ('${wireValue}') — not granted to any role`,
    );

    throw new Error(
      `${newUngranted.length} permission(s) were added to the Permission enum ` +
        `without a corresponding migration grant.\n\n` +
        `Every @RequirePermissions() guard that references these permissions ` +
        `will return 403 for all users.\n\n` +
        `To fix:\n` +
        `  1. Write a migration that grants each permission to the appropriate role(s).\n` +
        `     See docs/rbac.md — "Adding or Changing a Grant".\n` +
        `  2. Add the new migration class to the MIGRATIONS array in this file.\n` +
        `  3. Update docs/rbac.md to reflect the new grant.\n\n` +
        `If this is intentionally ungranted for now, add it to KNOWN_UNGRANTED_WIRE_VALUES\n` +
        `and add a ⚠️ callout to docs/rbac.md.\n\n` +
        `Ungranted permissions:\n` +
        lines.join('\n'),
    );
  });

  // ── Sanity checks — verify the mock captured real data ─────────────────

  it('captured at least one permission grant from the migrations', () => {
    expect(grantedPermissions.size).toBeGreaterThan(0);
  });

  it('captured the admin role grants from migration 1', () => {
    // Spot-check a handful of well-known admin permissions
    expect(grantedPermissions.has('admin:access')).toBe(true);
    expect(grantedPermissions.has('manage:roles')).toBe(true);
    expect(grantedPermissions.has('create:order')).toBe(true);
  });

  it('captured the fine-grained scopes from migration 2', () => {
    expect(grantedPermissions.has('inventory:write')).toBe(true);
    expect(grantedPermissions.has('dispatch:override')).toBe(true);
    expect(grantedPermissions.has('request:approve')).toBe(true);
    expect(grantedPermissions.has('dispute:resolve')).toBe(true);
    expect(grantedPermissions.has('verification:admin')).toBe(true);
    expect(grantedPermissions.has('settlement:release')).toBe(true);
  });
});

// ─── Known-gap assertions ───────────────────────────────────────────────────
//
// These tests pass while the gap exists and fail once the gap is fixed,
// prompting the developer to remove the entry from KNOWN_UNGRANTED_WIRE_VALUES
// and update docs/rbac.md.
//
describe('RBAC known gaps (issue #1548) — currently ungranted', () => {
  let grantedPermissions: Set<string>;

  beforeAll(async () => {
    const runner = buildMockQueryRunner();
    for (const migration of MIGRATIONS) {
      await migration.up(runner as any);
    }
    grantedPermissions = runner.grantedPermissions;
  });

  test.each([...KNOWN_UNGRANTED_WIRE_VALUES])(
    'Permission wire value "%s" is a known gap — not yet granted to any role',
    (wireValue) => {
      // Passes while ungranted; fails (and alerts the dev) once fixed.
      expect(grantedPermissions.has(wireValue)).toBe(false);
    },
  );
});
