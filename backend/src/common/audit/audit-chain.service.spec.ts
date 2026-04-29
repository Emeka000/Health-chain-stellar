import { AuditChainService } from '../audit-chain.service';
import { AuditChainEntryEntity } from '../audit-chain.entity';

const GENESIS = '0'.repeat(64);

function makeEntry(
  sequence: number,
  auditLogId: string,
  previousHash: string,
  entryHash: string,
): AuditChainEntryEntity {
  return {
    id: `entry-${sequence}`,
    auditLogId,
    sequence,
    entryHash,
    previousHash,
    chainedAt: new Date(),
  } as AuditChainEntryEntity;
}

function makeService(entries: AuditChainEntryEntity[] = []) {
  const saved: AuditChainEntryEntity[] = [...entries];

  const entryRepo = {
    findOne: jest.fn(async ({ order }: any) => {
      if (!saved.length) return null;
      return order?.sequence === 'DESC'
        ? saved[saved.length - 1]
        : saved[0];
    }),
    find: jest.fn(async ({ order }: any) => {
      const sorted = [...saved].sort((a, b) =>
        order?.sequence === 'DESC' ? b.sequence - a.sequence : a.sequence - b.sequence,
      );
      return sorted;
    }),
    save: jest.fn(async (e: AuditChainEntryEntity) => {
      saved.push(e);
      return e;
    }),
    create: jest.fn((d) => ({ ...d })),
  };

  const checkpointRepo = {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    save: jest.fn(async (c) => ({ id: 'cp-1', ...c })),
    create: jest.fn((d) => ({ ...d })),
  };

  const dataSource = {
    transaction: jest.fn(async (_isolation: string, cb: (em: any) => Promise<void>) => {
      const em = {
        findOne: entryRepo.findOne,
        save: jest.fn(async (Entity: any, data: any) => {
          const record = { id: `entry-${data.sequence}`, ...data };
          saved.push(record as AuditChainEntryEntity);
          return record;
        }),
      };
      return cb(em);
    }),
  };

  const svc = new AuditChainService(
    entryRepo as any,
    checkpointRepo as any,
    dataSource as any,
  );

  return { svc, entryRepo, checkpointRepo, dataSource, saved };
}

describe('AuditChainService', () => {
  describe('append', () => {
    it('creates the first entry with genesis previousHash', async () => {
      const { svc, saved } = makeService();
      await svc.append('log-1');
      expect(saved).toHaveLength(1);
      expect(saved[0].previousHash).toBe(GENESIS);
      expect(saved[0].sequence).toBe(1);
      expect(saved[0].entryHash).toHaveLength(64);
    });

    it('links subsequent entries to the previous hash', async () => {
      const { svc, saved } = makeService();
      await svc.append('log-1');
      await svc.append('log-2');
      expect(saved[1].previousHash).toBe(saved[0].entryHash);
      expect(saved[1].sequence).toBe(2);
    });

    it('does not throw on internal error (non-blocking)', async () => {
      const { svc, dataSource } = makeService();
      dataSource.transaction.mockRejectedValueOnce(new Error('DB down'));
      await expect(svc.append('log-x')).resolves.toBeUndefined();
    });
  });

  describe('verify', () => {
    it('returns ok=true for an intact chain', async () => {
      const { svc } = makeService();
      await svc.append('log-1');
      await svc.append('log-2');
      const report = await svc.verify();
      expect(report.ok).toBe(true);
      expect(report.firstBrokenSequence).toBeNull();
      expect(report.checkedEntries).toBe(2);
    });

    it('returns ok=true for an empty chain', async () => {
      const { svc } = makeService();
      const report = await svc.verify();
      expect(report.ok).toBe(true);
      expect(report.checkedEntries).toBe(0);
    });

    it('detects a tampered previousHash link', async () => {
      // Build a valid 2-entry chain then corrupt entry[1].previousHash
      const { svc, saved } = makeService();
      await svc.append('log-1');
      await svc.append('log-2');
      saved[1].previousHash = 'tampered'.padEnd(64, '0');

      const report = await svc.verify();
      expect(report.ok).toBe(false);
      expect(report.firstBrokenSequence).toBe(saved[1].sequence);
    });
  });

  describe('checkpoint', () => {
    it('returns null when chain is empty', async () => {
      const { svc } = makeService();
      const cp = await svc.checkpoint();
      expect(cp).toBeNull();
    });

    it('saves a checkpoint with the correct upToSequence', async () => {
      const { svc, checkpointRepo } = makeService();
      await svc.append('log-1');
      await svc.append('log-2');
      await svc.checkpoint();
      expect(checkpointRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ upToSequence: 2 }),
      );
    });

    it('rootHash is a 64-char hex string', async () => {
      const { svc, checkpointRepo } = makeService();
      await svc.append('log-1');
      await svc.checkpoint();
      const saved = checkpointRepo.save.mock.calls[0][0];
      expect(saved.rootHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('bootstrapHistoricalLogs', () => {
    it('appends all provided ids and anchors a checkpoint', async () => {
      const { svc, checkpointRepo, saved } = makeService();
      await svc.bootstrapHistoricalLogs(['log-a', 'log-b', 'log-c']);
      expect(saved).toHaveLength(3);
      expect(checkpointRepo.save).toHaveBeenCalledTimes(1);
    });
  });
});
