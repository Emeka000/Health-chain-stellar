import * as fs from 'fs';
import * as path from 'path';

/**
 * Contract method guard.
 *
 * Every `contractMethod` string used in `backend/src/` must exist in one of the
 * deployed contract specs (or the generated SDK bindings derived from them).
 *
 * This test exists because we previously queued Soroban calls to entrypoints
 * that no contract exposes (`create_blood_request`, `register_verified_organization`),
 * which failed on every submission attempt. See issue #1850.
 */

const SRC_ROOT = path.resolve(__dirname, '..');

/**
 * Known entrypoints per contract, mirrored from the deployed contract specs
 * (`packages/*-sdk` / `stellar contract bindings typescript`).
 *
 * When a contract gains or loses an entrypoint, update this map in the same
 * change that updates the contract. The test below fails loudly otherwise.
 */
const CONTRACT_SPECS: Record<string, string[]> = {
  requests: [
    'initialize',
    'create_request',
    'get_request',
    'list_requests',
    'accept_request',
    'start_delivery',
    'complete_request',
    'cancel_request',
    'update_request_status',
  ],
  identity: [
    'initialize',
    'register_organization',
    'verify_organization',
    'revoke_organization',
    'get_organization',
    'list_organizations',
    'is_verified',
  ],
  inventory: [
    'initialize',
    'add_blood_unit',
    'remove_blood_unit',
    'get_blood_unit',
    'list_blood_units',
    'update_blood_unit_status',
  ],
  payments: [
    'initialize',
    'create_payment',
    'release_payment',
    'refund_payment',
    'get_payment',
  ],
  reputation: [
    'initialize',
    'submit_rating',
    'get_reputation',
  ],
};

const ALL_KNOWN_METHODS: Set<string> = new Set(
  Object.values(CONTRACT_SPECS).flat(),
);

interface ContractMethodUsage {
  method: string;
  file: string;
  line: number;
}

/**
 * Recursively collect all `.ts` files under a directory, skipping tests,
 * node_modules and build output.
 */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === '__contracts__' ||
        entry.name === '__tests__'
      ) {
        continue;
      }
      results.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith('.ts')) {
      continue;
    }

    if (
      entry.name.endsWith('.spec.ts') ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.d.ts')
    ) {
      continue;
    }

    results.push(fullPath);
  }

  return results;
}

/**
 * Extract every `contractMethod` value from a source file.
 *
 * Matches both object-literal properties (`contractMethod: 'foo'`) and
 * quoted keys (`'contractMethod': 'foo'`), with either quote style.
 */
function extractContractMethods(
  filePath: string,
  content: string,
): ContractMethodUsage[] {
  const usages: ContractMethodUsage[] = [];
  const pattern = /['"]?contractMethod['"]?\s*:\s*(['"`])([^'"`]+)\1/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const method = match[2];
    const index = match.index;
    const line = content.slice(0, index).split('\n').length;
    usages.push({ method, file: filePath, line });
  }

  return usages;
}

describe('contract methods', () => {
  const sourceFiles = collectSourceFiles(SRC_ROOT);

  const usages: ContractMethodUsage[] = [];
  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    usages.push(...extractContractMethods(file, content));
  }

  it('finds at least one contractMethod usage to validate', () => {
    // Sanity check: if this fails, the scanner is broken (or the codebase
    // stopped using contractMethod), not the contracts.
    expect(usages.length).toBeGreaterThan(0);
  });

  it('only uses contractMethod strings present in a deployed contract spec', () => {
    const unknown = usages.filter((u) => !ALL_KNOWN_METHODS.has(u.method));

    const report = unknown
      .map(
        (u) =>
          `  - "${u.method}" at ${path.relative(SRC_ROOT, u.file)}:${u.line}`,
      )
      .join('\n');

    if (unknown.length > 0) {
      throw new Error(
        `Found ${unknown.length} contractMethod value(s) that do not exist in any contract spec:\n` +
          `${report}\n\n` +
          `Known methods: ${Array.from(ALL_KNOWN_METHODS).sort().join(', ')}\n\n` +
          `If a contract gained a new entrypoint, add it to CONTRACT_SPECS in ` +
          `${path.relative(process.cwd(), __filename)}.`,
      );
    }

    expect(unknown).toEqual([]);
  });

  it('does not reference the removed non-existent entrypoints', () => {
    // Regression guard for issue #1850.
    const forbidden = ['create_blood_request', 'register_verified_organization'];
    const offenders = usages.filter((u) => forbidden.includes(u.method));

    expect(offenders).toEqual([]);
  });
});