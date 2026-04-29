import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { ReadinessService } from './readiness.service';
import { ReadinessGraphService } from './services/readiness-graph.service';
import { ReadinessChecklistEntity } from './entities/readiness-checklist.entity';
import { ReadinessItemEntity } from './entities/readiness-item.entity';
import { ReadinessDependencyEntity } from './entities/readiness-dependency.entity';
import { ReadinessItemKey, ReadinessItemStatus, ReadinessChecklistStatus, ReadinessEntityType } from './enums/readiness.enum';

describe('ReadinessService (Dependency Integration)', () => {
  let service: ReadinessService;
  let graphService: ReadinessGraphService;
  let itemRepo: any;
  let checklistRepo: any;
  let dependencyRepo: any;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    itemRepo = {
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    checklistRepo = {
      findOne: jest.fn(),
      save: jest.fn((c) => Promise.resolve(c)),
      create: jest.fn(),
    };
    dependencyRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      create: jest.fn(),
      clear: jest.fn(),
    };
    eventEmitter = {
      emit: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadinessService,
        ReadinessGraphService,
        { provide: getRepositoryToken(ReadinessChecklistEntity), useValue: checklistRepo },
        { provide: getRepositoryToken(ReadinessItemEntity), useValue: itemRepo },
        { provide: getRepositoryToken(ReadinessDependencyEntity), useValue: dependencyRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<ReadinessService>(ReadinessService);
    graphService = module.get<ReadinessGraphService>(ReadinessGraphService);
  });

  it('should block item completion if prerequisite is not met', async () => {
    // Setup: Storage depends on Licensing
    const deps = [{ parentItemKey: ReadinessItemKey.STORAGE, dependsOnItemKey: ReadinessItemKey.LICENSING }];
    dependencyRepo.find.mockResolvedValue(deps);
    await graphService.refreshGraph();

    const checklist = {
      id: 'c1',
      status: ReadinessChecklistStatus.INCOMPLETE,
      items: [
        { itemKey: ReadinessItemKey.LICENSING, status: ReadinessItemStatus.PENDING },
        { itemKey: ReadinessItemKey.STORAGE, status: ReadinessItemStatus.PENDING },
      ],
    };
    checklistRepo.findOne.mockResolvedValue(checklist);

    // Attempt to complete STORAGE
    await expect(
      service.updateItem('c1', ReadinessItemKey.STORAGE, 'user1', { status: ReadinessItemStatus.COMPLETE })
    ).rejects.toThrow("Cannot complete item 'storage' because it is blocked");
  });

  it('should allow item completion if prerequisite is met', async () => {
    // Setup: Storage depends on Licensing
    const deps = [{ parentItemKey: ReadinessItemKey.STORAGE, dependsOnItemKey: ReadinessItemKey.LICENSING }];
    dependencyRepo.find.mockResolvedValue(deps);
    await graphService.refreshGraph();

    const checklist = {
      id: 'c1',
      status: ReadinessChecklistStatus.INCOMPLETE,
      items: [
        { itemKey: ReadinessItemKey.LICENSING, status: ReadinessItemStatus.COMPLETE },
        { itemKey: ReadinessItemKey.STORAGE, status: ReadinessItemStatus.PENDING },
      ],
    };
    checklistRepo.findOne.mockResolvedValue(checklist);
    itemRepo.find.mockResolvedValue(checklist.items);
    itemRepo.save.mockResolvedValue({ ...checklist.items[1], status: ReadinessItemStatus.COMPLETE });

    // Attempt to complete STORAGE
    const result = await service.updateItem('c1', ReadinessItemKey.STORAGE, 'user1', { status: ReadinessItemStatus.COMPLETE });
    expect(result).toBeDefined();
    expect(eventEmitter.emit).toHaveBeenCalledWith('readiness.item_updated', expect.anything());
  });

  it('should generate a report with blocking details', async () => {
    const deps = [{ parentItemKey: ReadinessItemKey.STORAGE, dependsOnItemKey: ReadinessItemKey.LICENSING }];
    dependencyRepo.find.mockResolvedValue(deps);
    await graphService.refreshGraph();

    const checklist = {
      id: 'c1',
      status: ReadinessChecklistStatus.INCOMPLETE,
      items: [
        { itemKey: ReadinessItemKey.LICENSING, status: ReadinessItemStatus.PENDING },
        { itemKey: ReadinessItemKey.STORAGE, status: ReadinessItemStatus.PENDING },
      ],
    };
    checklistRepo.findOne.mockResolvedValue(checklist);

    const report = await service.getReadinessReport('c1');
    const storageItem = report.items.find(i => i.itemKey === ReadinessItemKey.STORAGE);
    expect(storageItem!.isBlocked).toBe(true);
    expect(storageItem!.blockingReasons[0]).toContain('licensing');
  });

  it('should ignore dependency if condition is not met', async () => {
    // Setup: Storage depends on Licensing ONLY if entityType == 'region'
    const deps = [
      { 
        parentItemKey: ReadinessItemKey.STORAGE, 
        dependsOnItemKey: ReadinessItemKey.LICENSING,
        conditionExpression: "entityType == 'region'"
      }
    ];
    dependencyRepo.find.mockResolvedValue(deps);
    await graphService.refreshGraph();

    // Checklist for a PARTNER (should ignore the dependency)
    const checklist = {
      id: 'c1',
      entityType: ReadinessEntityType.PARTNER,
      status: ReadinessChecklistStatus.INCOMPLETE,
      items: [
        { itemKey: ReadinessItemKey.LICENSING, status: ReadinessItemStatus.PENDING },
        { itemKey: ReadinessItemKey.STORAGE, status: ReadinessItemStatus.PENDING },
      ],
    };
    checklistRepo.findOne.mockResolvedValue(checklist);

    const report = await service.getReadinessReport('c1');
    const storageItem = report.items.find(i => i.itemKey === ReadinessItemKey.STORAGE);
    expect(storageItem!.isBlocked).toBe(false); // Licensing is pending but condition not met
  });
});
