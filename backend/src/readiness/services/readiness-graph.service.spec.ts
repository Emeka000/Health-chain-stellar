import { ReadinessGraphService } from './readiness-graph.service';
import { ReadinessItemKey, ReadinessItemStatus } from '../enums/readiness.enum';
import { ReadinessItemEntity } from '../entities/readiness-item.entity';

describe('ReadinessGraphService', () => {
  let service: ReadinessGraphService;
  let mockDependencyRepo: any;

  beforeEach(() => {
    mockDependencyRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    service = new ReadinessGraphService(mockDependencyRepo);
  });

  it('should detect cycles in dependencies', async () => {
    const dependencies = [
      { parentItemKey: ReadinessItemKey.LICENSING, dependsOnItemKey: ReadinessItemKey.STAFFING },
      { parentItemKey: ReadinessItemKey.STAFFING, dependsOnItemKey: ReadinessItemKey.LICENSING },
    ];
    mockDependencyRepo.find.mockResolvedValue(dependencies);

    await expect(service.refreshGraph()).rejects.toThrow('Cycle detected');
  });

  it('should identify blockers correctly', async () => {
    const dependencies = [
      { parentItemKey: ReadinessItemKey.STORAGE, dependsOnItemKey: ReadinessItemKey.LICENSING },
    ];
    mockDependencyRepo.find.mockResolvedValue(dependencies);
    await service.refreshGraph();

    const allItems = [
      { itemKey: ReadinessItemKey.LICENSING, status: ReadinessItemStatus.PENDING } as ReadinessItemEntity,
      { itemKey: ReadinessItemKey.STORAGE, status: ReadinessItemStatus.PENDING } as ReadinessItemEntity,
    ];

    const blockers = service.getBlockers(ReadinessItemKey.STORAGE, allItems);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].prerequisiteKey).toBe(ReadinessItemKey.LICENSING);
  });

  it('should not block if prerequisite is COMPLETE', async () => {
    const dependencies = [
      { parentItemKey: ReadinessItemKey.STORAGE, dependsOnItemKey: ReadinessItemKey.LICENSING },
    ];
    mockDependencyRepo.find.mockResolvedValue(dependencies);
    await service.refreshGraph();

    const allItems = [
      { itemKey: ReadinessItemKey.LICENSING, status: ReadinessItemStatus.COMPLETE } as ReadinessItemEntity,
      { itemKey: ReadinessItemKey.STORAGE, status: ReadinessItemStatus.PENDING } as ReadinessItemEntity,
    ];

    const blockers = service.getBlockers(ReadinessItemKey.STORAGE, allItems);
    expect(blockers).toHaveLength(0);
  });

  it('should not block if prerequisite is WAIVED', async () => {
    const dependencies = [
      { parentItemKey: ReadinessItemKey.STORAGE, dependsOnItemKey: ReadinessItemKey.LICENSING },
    ];
    mockDependencyRepo.find.mockResolvedValue(dependencies);
    await service.refreshGraph();

    const allItems = [
      { itemKey: ReadinessItemKey.LICENSING, status: ReadinessItemStatus.WAIVED } as ReadinessItemEntity,
      { itemKey: ReadinessItemKey.STORAGE, status: ReadinessItemStatus.PENDING } as ReadinessItemEntity,
    ];

    const blockers = service.getBlockers(ReadinessItemKey.STORAGE, allItems);
    expect(blockers).toHaveLength(0);
  });

  it('should handle complex chains', async () => {
    // A -> B -> C
    const dependencies = [
      { parentItemKey: ReadinessItemKey.STORAGE, dependsOnItemKey: ReadinessItemKey.STAFFING },
      { parentItemKey: ReadinessItemKey.STAFFING, dependsOnItemKey: ReadinessItemKey.LICENSING },
    ];
    mockDependencyRepo.find.mockResolvedValue(dependencies);
    await service.refreshGraph();

    const allItems = [
      { itemKey: ReadinessItemKey.LICENSING, status: ReadinessItemStatus.COMPLETE } as ReadinessItemEntity,
      { itemKey: ReadinessItemKey.STAFFING, status: ReadinessItemStatus.PENDING } as ReadinessItemEntity,
      { itemKey: ReadinessItemKey.STORAGE, status: ReadinessItemStatus.PENDING } as ReadinessItemEntity,
    ];

    // Staffing is not blocked (Licensing is complete)
    expect(service.getBlockers(ReadinessItemKey.STAFFING, allItems)).toHaveLength(0);
    
    // Storage is blocked (Staffing is pending)
    const blockers = service.getBlockers(ReadinessItemKey.STORAGE, allItems);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].prerequisiteKey).toBe(ReadinessItemKey.STAFFING);
  });
});
