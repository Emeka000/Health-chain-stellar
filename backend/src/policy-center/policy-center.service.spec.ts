import { BadRequestException } from '@nestjs/common';

import { PolicyVersionEntity } from './entities/policy-version.entity';
import { PolicyVersionStatus } from './enums/policy-version-status.enum';
import { PolicyCenterService } from './policy-center.service';
import { PolicyReplayService } from './policy-replay.service';

describe('PolicyCenterService rollback (Issue #1501)', () => {
  let service: PolicyCenterService;
  let repo: {
    findOne: jest.Mock;
    save: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let txRepo: { findOne: jest.Mock; save: jest.Mock };

  const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

  const makeVersion = (
    overrides: Partial<PolicyVersionEntity>,
  ): PolicyVersionEntity =>
    ({
      policyName: 'operational-core',
      rules: service.getDefaultRules(),
      effectiveFrom: hourAgo(),
      effectiveTo: null,
      rollbackFromVersionId: null,
      rulesHash: null,
      immutable: false,
      ...overrides,
    }) as PolicyVersionEntity;

  beforeEach(() => {
    txRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(txRepo) };
    repo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
      manager: {
        transaction: jest
          .fn()
          .mockImplementation((cb: (m: typeof manager) => unknown) =>
            cb(manager),
          ),
      },
    };

    const replayService = new PolicyReplayService(repo as any);
    service = new PolicyCenterService(repo as any, replayService);
  });

  it('re-activates a previously superseded version (past effectiveTo)', async () => {
    const previous = makeVersion({
      id: 'v1',
      version: 1,
      status: PolicyVersionStatus.SUPERSEDED,
      effectiveTo: hourAgo(),
      immutable: true,
    });
    const current = makeVersion({
      id: 'v2',
      version: 2,
      status: PolicyVersionStatus.ACTIVE,
    });
    repo.findOne.mockResolvedValueOnce(previous);
    txRepo.findOne.mockResolvedValueOnce(current);

    const result = await service.rollbackToVersion('v1', 'admin');

    expect(result.id).toBe('v1');
    expect(result.status).toBe(PolicyVersionStatus.ACTIVE);
    expect(result.effectiveTo).toBeNull();
    expect(result.activatedBy).toBe('admin');
    expect(result.rulesHash).toHaveLength(64);

    expect(current.status).toBe(PolicyVersionStatus.ROLLED_BACK);
    expect(current.effectiveTo).toBeInstanceOf(Date);
    expect(current.rollbackFromVersionId).toBe('v1');
  });

  it('performs demote and activate inside a single transaction', async () => {
    const previous = makeVersion({
      id: 'v1',
      version: 1,
      status: PolicyVersionStatus.SUPERSEDED,
      effectiveTo: hourAgo(),
    });
    const current = makeVersion({
      id: 'v2',
      version: 2,
      status: PolicyVersionStatus.ACTIVE,
    });
    repo.findOne.mockResolvedValueOnce(previous);
    txRepo.findOne.mockResolvedValueOnce(current);
    txRepo.save
      .mockImplementationOnce((e) => Promise.resolve(e))
      .mockRejectedValueOnce(new Error('db down'));

    await expect(service.rollbackToVersion('v1', 'admin')).rejects.toThrow(
      'db down',
    );

    expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(txRepo.save).toHaveBeenCalledTimes(2);
    // Nothing is written outside the transaction, so a failure rolls back the demotion.
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects rollback to a version whose effectiveFrom is in the future', async () => {
    repo.findOne.mockResolvedValueOnce(
      makeVersion({
        id: 'v3',
        version: 3,
        status: PolicyVersionStatus.DRAFT,
        effectiveFrom: new Date(Date.now() + 60 * 60 * 1000),
      }),
    );

    await expect(service.rollbackToVersion('v3', 'admin')).rejects.toThrow(
      BadRequestException,
    );
    expect(repo.manager.transaction).not.toHaveBeenCalled();
  });

  it('activateVersion still refuses an expired version', async () => {
    repo.findOne.mockResolvedValueOnce(
      makeVersion({
        id: 'v1',
        version: 1,
        status: PolicyVersionStatus.DRAFT,
        effectiveTo: hourAgo(),
      }),
    );

    await expect(service.activateVersion('v1', 'admin')).rejects.toThrow(
      BadRequestException,
    );
    expect(repo.manager.transaction).not.toHaveBeenCalled();
  });

  it('activateVersion supersedes the current version transactionally', async () => {
    const draft = makeVersion({
      id: 'v3',
      version: 3,
      status: PolicyVersionStatus.DRAFT,
    });
    const current = makeVersion({
      id: 'v2',
      version: 2,
      status: PolicyVersionStatus.ACTIVE,
    });
    repo.findOne.mockResolvedValueOnce(draft);
    txRepo.findOne.mockResolvedValueOnce(current);

    const result = await service.activateVersion('v3', 'admin');

    expect(result.status).toBe(PolicyVersionStatus.ACTIVE);
    expect(result.immutable).toBe(true);
    expect(current.status).toBe(PolicyVersionStatus.SUPERSEDED);
    expect(current.rollbackFromVersionId).toBeNull();
    expect(repo.save).not.toHaveBeenCalled();
  });
});
