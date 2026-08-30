import { ReadinessController } from './readiness.controller';
import { ReadinessService } from './readiness.service';
import { ReadinessEntityType, ReadinessItemKey } from './enums/readiness.enum';
import { ReadinessChecklistStatus, ReadinessItemStatus } from './enums/readiness.enum';

describe('ReadinessController', () => {
  let controller: ReadinessController;
  let service: {
    createChecklist: jest.Mock;
    listChecklists: jest.Mock;
    updateDependencies: jest.Mock;
    listBlocked: jest.Mock;
    getChecklist: jest.Mock;
    getReadinessReport: jest.Mock;
    getChecklistByEntity: jest.Mock;
    updateItem: jest.Mock;
    signOff: jest.Mock;
    isReady: jest.Mock;
  };

  beforeEach(() => {
    service = {
      createChecklist: jest.fn(),
      listChecklists: jest.fn(),
      updateDependencies: jest.fn(),
      listBlocked: jest.fn(),
      getChecklist: jest.fn(),
      getReadinessReport: jest.fn(),
      getChecklistByEntity: jest.fn(),
      updateItem: jest.fn(),
      signOff: jest.fn(),
      isReady: jest.fn(),
    };

    controller = new ReadinessController(service as unknown as ReadinessService);
  });

  it('uses req.user.id for readiness item updates', async () => {
    const dto = { status: ReadinessItemStatus.COMPLETE };
    service.updateItem.mockResolvedValue({ ok: true });

    await controller.updateItem(
      'cl-1',
      ReadinessItemKey.LICENSING,
      dto as any,
      { user: { id: 'user-123', sub: 'evil-sub' } },
    );

    expect(service.updateItem).toHaveBeenCalledWith(
      'cl-1',
      ReadinessItemKey.LICENSING,
      'user-123',
      dto,
    );
  });

  it('uses req.user.id for sign-off', async () => {
    const dto = { reviewerNotes: 'all good' };
    service.signOff.mockResolvedValue({ status: ReadinessChecklistStatus.SIGNED_OFF });

    await controller.signOff('cl-1', dto as any, {
      user: { id: 'admin-1', sub: 'spoofed-sub' },
    });

    expect(service.signOff).toHaveBeenCalledWith('cl-1', 'admin-1', dto);
  });

  it('keeps dependency updates on the service path', async () => {
    const dto = [
      {
        parentItemKey: ReadinessItemKey.STORAGE,
        dependsOnItemKey: ReadinessItemKey.LICENSING,
      },
    ];
    service.updateDependencies.mockResolvedValue([{ ok: true }]);

    await controller.updateDependencies(dto);

    expect(service.updateDependencies).toHaveBeenCalledWith(dto);
  });

  it('only exposes readiness gating from the service', async () => {
    service.isReady.mockResolvedValue(true);

    await controller.isReady(ReadinessEntityType.PARTNER, 'org-1');

    expect(service.isReady).toHaveBeenCalledWith(
      ReadinessEntityType.PARTNER,
      'org-1',
    );
  });
});
