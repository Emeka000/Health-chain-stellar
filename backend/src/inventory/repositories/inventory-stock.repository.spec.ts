import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { InventoryStockEntity } from '../entities/inventory-stock.entity';
import { InventoryStockRepository } from './inventory-stock.repository';

const makeStock = (overrides: Partial<InventoryStockEntity> = {}): InventoryStockEntity =>
  ({
    id: 'stock-1',
    bloodBankId: 'bank-1',
    bloodType: 'O+',
    availableUnitsMl: 500,
    version: 2,
    ...overrides,
  } as InventoryStockEntity);

describe('InventoryStockRepository', () => {
  let repo: InventoryStockRepository;

  const qb: Record<string, jest.Mock> = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };

  const mockTypeormRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
    create: jest.fn().mockImplementation((dto) => dto),
    merge: jest.fn().mockImplementation((e, u) => ({ ...e, ...u })),
    remove: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset qb chain mocks
    Object.values(qb).forEach((fn) => {
      if (typeof fn.mockReturnThis === 'function') fn.mockReturnThis();
    });
    qb.execute.mockResolvedValue({ affected: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryStockRepository,
        { provide: getRepositoryToken(InventoryStockEntity), useValue: mockTypeormRepo },
      ],
    }).compile();

    repo = module.get(InventoryStockRepository);
  });

  describe('findById', () => {
    it('returns the entity when found', async () => {
      mockTypeormRepo.findOne.mockResolvedValue(makeStock());
      const result = await repo.findById('stock-1');
      expect(result?.id).toBe('stock-1');
    });

    it('returns null when not found', async () => {
      mockTypeormRepo.findOne.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findByBankAndType', () => {
    it('queries by bloodBankId and bloodType', async () => {
      mockTypeormRepo.findOne.mockResolvedValue(makeStock());
      await repo.findByBankAndType('bank-1', 'O+');
      expect(mockTypeormRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ bloodBankId: 'bank-1', bloodType: 'O+' }) }),
      );
    });
  });

  describe('findAndCount', () => {
    it('passes where, skip, and take to the underlying repo', async () => {
      mockTypeormRepo.findAndCount.mockResolvedValue([[makeStock()], 1]);
      const [data, count] = await repo.findAndCount({ bloodBankId: 'bank-1' } as any, 0, 25);
      expect(count).toBe(1);
      expect(data).toHaveLength(1);
      expect(mockTypeormRepo.findAndCount).toHaveBeenCalledWith({ where: { bloodBankId: 'bank-1' }, skip: 0, take: 25 });
    });
  });

  describe('save / create / merge / remove', () => {
    it('save delegates to repo.save', async () => {
      const stock = makeStock();
      await repo.save(stock);
      expect(mockTypeormRepo.save).toHaveBeenCalledWith(stock);
    });

    it('create delegates to repo.create', () => {
      repo.create({ bloodBankId: 'bank-1' });
      expect(mockTypeormRepo.create).toHaveBeenCalledWith({ bloodBankId: 'bank-1' });
    });

    it('merge delegates to repo.merge', () => {
      const stock = makeStock();
      repo.merge(stock, { availableUnitsMl: 999 });
      expect(mockTypeormRepo.merge).toHaveBeenCalledWith(stock, { availableUnitsMl: 999 });
    });

    it('remove delegates to repo.remove', async () => {
      const stock = makeStock();
      await repo.remove(stock);
      expect(mockTypeormRepo.remove).toHaveBeenCalledWith(stock);
    });
  });

  describe('getLowStock', () => {
    it('builds a query with the threshold', async () => {
      qb.getMany.mockResolvedValue([makeStock({ availableUnitsMl: 5 })]);
      const result = await repo.getLowStock(10);
      expect(result).toHaveLength(1);
      expect(qb.where).toHaveBeenCalledWith(
        expect.stringContaining('availableUnitsMl'),
        expect.objectContaining({ threshold: 10 }),
      );
    });
  });

  describe('atomicDecrement', () => {
    it('builds update query with correct set clause', async () => {
      await repo.atomicDecrement('stock-1', 2, 100);
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({ availableUnitsMl: expect.any(Function) }),
      );
      expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 'stock-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('"version" = :version', { version: 2 });
    });

    it('returns UpdateResult from execute', async () => {
      qb.execute.mockResolvedValue({ affected: 1 });
      const result = await repo.atomicDecrement('stock-1', 2, 100);
      expect(result.affected).toBe(1);
    });
  });

  describe('atomicIncrement', () => {
    it('builds update query with increment set clause', async () => {
      await repo.atomicIncrement('stock-1', 2, 200);
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({ availableUnitsMl: expect.any(Function) }),
      );
    });

    it('returns UpdateResult from execute', async () => {
      qb.execute.mockResolvedValue({ affected: 1 });
      const result = await repo.atomicIncrement('stock-1', 2, 200);
      expect(result.affected).toBe(1);
    });
  });

  describe('bumpVersion', () => {
    it('builds update query that increments version only', async () => {
      await repo.bumpVersion('stock-1');
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({ version: expect.any(Function) }),
      );
      expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 'stock-1' });
    });
  });
});
