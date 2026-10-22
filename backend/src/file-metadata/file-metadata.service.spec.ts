import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FileLifecycleStatus, FileOwnerType } from './entities/file-metadata.entity';
import { FileMetadataService } from './file-metadata.service';

function makeRecord(overrides: Partial<object> = {}) {
  return {
    id: 'file-1',
    ownerType: FileOwnerType.PROOF_BUNDLE,
    ownerId: 'owner-1',
    storagePath: '/tmp/test.pdf',
    sha256Hash: 'abc123',
    status: FileLifecycleStatus.ACTIVE,
    metadataVersion: 1,
    legalHold: false,
    legalHoldBy: null,
    legalHoldReason: null,
    retentionExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(record?: object | null) {
  const repo = {
    create: jest.fn((d) => ({ ...d })),
    save: jest.fn(async (r) => ({ ...r })),
    findOne: jest.fn(async () => record ?? null),
    update: jest.fn(async () => undefined),
    find: jest.fn(async () => []),
  };
  const auditRepo = {
    create: jest.fn((d) => ({ ...d })),
    save: jest.fn(async (r) => r),
    find: jest.fn(async () => []),
  };
  return { svc: new FileMetadataService(repo as any, auditRepo as any), repo, auditRepo };
}

describe('FileMetadataService — issue #621', () => {
  it('registers a file with version 1', async () => {
    const { svc, repo } = makeService();
    await svc.register({
      ownerType: FileOwnerType.PROOF_BUNDLE,
      ownerId: 'owner-1',
      storagePath: '/tmp/test.pdf',
    });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ metadataVersion: 1 }));
  });

  it('updatePolicy increments version and writes audit log', async () => {
    const record = makeRecord();
    const { svc, auditRepo } = makeService(record);
    await svc.updatePolicy('file-1', { retentionExpiresAt: new Date('2030-01-01') }, 'admin-1', 'extend retention');
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file-1', actorId: 'admin-1', version: 2 }),
    );
  });

  it('placeLegalHold prevents deletion', async () => {
    const record = makeRecord({ legalHold: true });
    const { svc } = makeService(record);
    await expect(svc.delete('file-1', 'user-1')).rejects.toThrow(ForbiddenException);
  });

  it('placeLegalHold is idempotent', async () => {
    const record = makeRecord({ legalHold: true });
    const { svc, auditRepo } = makeService(record);
    await svc.placeLegalHold('file-1', 'admin-1', 'litigation');
    expect(auditRepo.save).not.toHaveBeenCalled();
  });

  it('releaseLegalHold clears hold and writes audit log', async () => {
    const record = makeRecord({ legalHold: true, legalHoldBy: 'admin-1' });
    const { svc, auditRepo } = makeService(record);
    await svc.releaseLegalHold('file-1', 'admin-1', 'case closed');
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file-1', version: 2 }),
    );
  });

  it('findOrFail throws NotFoundException for unknown id', async () => {
    const { svc } = makeService(null);
    await expect(svc.getAuditLog('unknown')).rejects.toThrow(NotFoundException);
  });

  it('findGcCandidates excludes files under legal hold', async () => {
    const record = makeRecord({ legalHold: true, status: FileLifecycleStatus.ORPHANED });
    const { svc, repo } = makeService(record);
    repo.find.mockResolvedValue([record]);
    const candidates = await svc.findGcCandidates();
    expect(candidates).toHaveLength(0);
  });
});
