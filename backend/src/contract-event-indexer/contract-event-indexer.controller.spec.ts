/**
 * Tests for ContractEventIndexerController authorization
 *
 * Covers issue #1187: ingest, ingest/batch, replay, cursors/reset, and
 * poison-event operator endpoints must be gated behind ADMIN_ACCESS permission.
 * Regular authenticated users must receive 403 Forbidden on these endpoints.
 */

import { PERMISSIONS_KEY } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { ContractEventIndexerController } from './contract-event-indexer.controller';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reads the @RequirePermissions() metadata from a controller method.
 * Returns an empty array when no decorator is present.
 */
function getRequiredPermissions(
  controller: ContractEventIndexerController,
  methodName: string,
): Permission[] {
  const proto = Object.getPrototypeOf(controller) as Record<string, unknown>;
  const handler = proto[methodName];
  if (typeof handler !== 'function') return [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? [];
}

function makeController(): ContractEventIndexerController {
  const service = {
    ingest: jest.fn(),
    ingestBatch: jest.fn(),
    replayFromLedger: jest.fn(),
    resetCursor: jest.fn(),
    getPoisonEvents: jest.fn(),
    quarantinePoisonEvent: jest.fn(),
    replayPoisonEvent: jest.fn(),
    discardPoisonEvent: jest.fn(),
    findAll: jest.fn(),
    findByEntityRef: jest.fn(),
    getCursors: jest.fn(),
    verifyIndexed: jest.fn(),
  } as never;
  return new ContractEventIndexerController(service);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ContractEventIndexerController', () => {
  describe('#1187 — endpoint authorization metadata', () => {
    let controller: ContractEventIndexerController;

    beforeEach(() => {
      controller = makeController();
    });

    const adminGatedMethods = [
      'ingest',
      'ingestBatch',
      'replay',
      'resetCursor',
      'getPoisonEvents',
      'quarantine',
      'replayPoison',
      'discardPoison',
    ] as const;

    test.each(adminGatedMethods)(
      '%s() must require Permission.ADMIN_ACCESS',
      (method) => {
        const perms = getRequiredPermissions(controller, method);
        expect(perms).toContain(Permission.ADMIN_ACCESS);
      },
    );

    it('read-only endpoints (findAll, findByEntityRef, getCursors) do NOT require ADMIN_ACCESS', () => {
      const readMethods = ['findAll', 'findByEntityRef', 'getCursors'];
      for (const method of readMethods) {
        const perms = getRequiredPermissions(controller, method);
        expect(perms).not.toContain(Permission.ADMIN_ACCESS);
      }
    });
  });
});
