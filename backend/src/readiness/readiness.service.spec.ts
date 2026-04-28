import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CreateChecklistDto } from './dto/readiness.dto';
import { ReadinessChecklistEntity } from './entities/readiness-checklist.entity';
import { ReadinessItemEntity } from './entities/readiness-item.entity';
import {
  ReadinessChecklistStatus,
  ReadinessEntityType,
  ReadinessItemKey,
  ReadinessItemStatus,
} from './enums/readiness.enum';
import { ReadinessService } from './readiness.service';

const ALL_KEYS = Object.values(ReadinessItemKey);

function makeItems(status: ReadinessItemStatus = ReadinessItemStatus.PENDING) {
  return ALL_KEYS.map((key) => ({
    id: `item-${key}`,
    itemKey: key,
    status,
    evidenceUrl: null,
    notes: null,
    completedAt: null,
    completedBy: null,
    checklistId: 'cl-1',
  }));
}

function makeChecklist(
  overrides: Partial<ReadinessChecklistEntity> = {},
): ReadinessChecklistEntity {
  return {
    id: 'cl-1',
    entityType: ReadinessEntityType.PARTNER,
    entityId: 'org-1',
    status: ReadinessChecklistStatus.INCOMPLETE,
    signedOffBy: null,
    signedOffAt: null,
    reviewerNotes: null,
    items: makeItems(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ReadinessChecklistEntity;
}

describe('ReadinessService', () => {
  let service: ReadinessService;
  let checklistRepo: Record<string, jest.Mock>;
  let itemRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    checklistRepo = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn((e) => Promise.resolve({ id: 'cl-1', ...e })),
      findOne: jest.fn(() => Promise.resolve(null)),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        subQuery: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        getQuery: jest.fn(() => 'SELECT 1'),
        getMany: jest.fn(() => Promise.resolve([])),
      })),
    };

    itemRepo = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn((e) => Promise.resolve(e)),
      find: jest.fn(() => Promise.resolve(makeItems())),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadinessService,
        {
          provide: getRepositoryToken(ReadinessChecklistEntity),
          useValue: checklistRepo,
        },
        {
          provide: getRepositoryToken(ReadinessItemEntity),
          useValue: itemRepo,
        },
      ],
    }).compile();

    service = module.get(ReadinessService);
  });

  describe('createChecklist', () => {
    it('creates checklist with all items seeded as PENDING', async () => {
      checklistRepo.findOne.mockResolvedValue(null);
      checklistRepo.save.mockResolvedValue({ id: 'cl-1' });
      // second findOne (getChecklist) returns full checklist
      checklistRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeChecklist());

      const dto: CreateChecklistDto = {
        entityType: ReadinessEntityType.PARTNER,
        entityId: 'org-1',
      };
      await service.createChecklist(dto);

      expect(itemRepo.save).toHaveBeenCalled();

      const calls = itemRepo.save.mock.calls as unknown as [
        ReadinessItemEntity[],
      ][];
      const savedItems = calls[0][0];
      expect(savedItems).toHaveLength(Object.values(ReadinessItemKey).length);
      expect(
        savedItems.every((i) => i.status === ReadinessItemStatus.PENDING),
      ).toBe(true);
    });

    it('throws ConflictException if checklist already exists', async () => {
      checklistRepo.findOne.mockResolvedValue(makeChecklist());
      await expect(
        service.createChecklist({
          entityType: ReadinessEntityType.PARTNER,
          entityId: 'org-1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getChecklist', () => {
    it('returns checklist when found', async () => {
      checklistRepo.findOne.mockResolvedValue(makeChecklist());
      const result = await service.getChecklist('cl-1');
      expect(result.id).toBe('cl-1');
    });

    it('throws NotFoundException when not found', async () => {
      checklistRepo.findOne.mockResolvedValue(null);
      await expect(service.getChecklist('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateItem', () => {
    it('marks item complete and recomputes status', async () => {
      const checklist = makeChecklist();
      checklistRepo.findOne.mockResolvedValue(checklist);
      itemRepo.save.mockResolvedValue({});
      // After update, all items complete
      itemRepo.find.mockResolvedValue(makeItems(ReadinessItemStatus.COMPLETE));
      checklistRepo.save.mockResolvedValue({
        ...checklist,
        status: ReadinessChecklistStatus.READY,
      });

      const result = await service.updateItem(
        'cl-1',
        ReadinessItemKey.LICENSING,
        'user-1',
        {
          status: ReadinessItemStatus.COMPLETE,
          evidenceUrl: 'https://doc.pdf',
        },
      );
      expect(result.status).toBe(ReadinessChecklistStatus.READY);
    });

    it('throws BadRequestException on signed-off checklist', async () => {
      checklistRepo.findOne.mockResolvedValue(
        makeChecklist({ status: ReadinessChecklistStatus.SIGNED_OFF }),
      );
      await expect(
        service.updateItem('cl-1', ReadinessItemKey.LICENSING, 'u', {
          status: ReadinessItemStatus.COMPLETE,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for unknown item key', async () => {
      checklistRepo.findOne.mockResolvedValue(makeChecklist({ items: [] }));
      await expect(
        service.updateItem('cl-1', ReadinessItemKey.LICENSING, 'u', {
          status: ReadinessItemStatus.COMPLETE,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('signOff', () => {
    it('signs off when all items are complete', async () => {
      const checklist = makeChecklist({
        items: makeItems(ReadinessItemStatus.COMPLETE),
      });
      checklistRepo.findOne.mockResolvedValue(checklist);
      checklistRepo.save.mockResolvedValue({
        ...checklist,
        status: ReadinessChecklistStatus.SIGNED_OFF,
        signedOffBy: 'admin-1',
      });

      const result = await service.signOff('cl-1', 'admin-1', {
        reviewerNotes: 'All good',
      });
      expect(result.status).toBe(ReadinessChecklistStatus.SIGNED_OFF);
      expect(result.signedOffBy).toBe('admin-1');
    });

    it('throws BadRequestException when pending items remain', async () => {
      checklistRepo.findOne.mockResolvedValue(makeChecklist()); // items are PENDING
      await expect(service.signOff('cl-1', 'admin-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('isReady', () => {
    it('returns true when signed-off checklist exists', async () => {
      checklistRepo.findOne.mockResolvedValue(
        makeChecklist({ status: ReadinessChecklistStatus.SIGNED_OFF }),
      );
      const result = await service.isReady(
        ReadinessEntityType.PARTNER,
        'org-1',
      );
      expect(result).toBe(true);
    });

    it('returns false when no signed-off checklist', async () => {
      checklistRepo.findOne.mockResolvedValue(null);
      const result = await service.isReady(
        ReadinessEntityType.PARTNER,
        'org-1',
      );
      expect(result).toBe(false);
    });
  });
});
