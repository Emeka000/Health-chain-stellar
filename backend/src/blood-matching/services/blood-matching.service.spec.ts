import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { BloodRequestItemEntity } from '../../blood-requests/entities/blood-request-item.entity';
import { BloodRequestEntity } from '../../blood-requests/entities/blood-request.entity';
import { BloodUnitEntity } from '../../blood-units/entities/blood-unit.entity';
import { InventoryStockEntity } from '../../inventory/entities/inventory-stock.entity';

import { BloodMatchingService } from './blood-matching.service';

describe('BloodMatchingService', () => {
  let service: BloodMatchingService;
  let bloodUnitRepository: Repository<BloodUnitEntity>;

  const mockBloodUnit: BloodUnitEntity = {
    id: 'unit-1',
    unitCode: 'UNIT-001',
    bloodType: 'A+' as any,
    status: 'available' as any,
    component: 'whole_blood' as any,
    organizationId: 'bank-1',
    volumeMl: 450,
    collectedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    testResults: null,
    storageTemperatureCelsius: 4,
    storageLocation: null,
    donorId: null,
    blockchainUnitId: null,
    blockchainTxHash: null,
    statusHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as BloodUnitEntity;

  const mockBloodUnitRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockBloodRequestRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockBloodRequestItemRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockInventoryRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BloodMatchingService,
        {
          provide: getRepositoryToken(BloodUnitEntity),
          useValue: mockBloodUnitRepository,
        },
        {
          provide: getRepositoryToken(BloodRequestEntity),
          useValue: mockBloodRequestRepository,
        },
        {
          provide: getRepositoryToken(BloodRequestItemEntity),
          useValue: mockBloodRequestItemRepository,
        },
        {
          provide: getRepositoryToken(InventoryStockEntity),
          useValue: mockInventoryRepository,
        },
      ],
    }).compile();

    service = module.get<BloodMatchingService>(BloodMatchingService);
    bloodUnitRepository = module.get<Repository<BloodUnitEntity>>(
      getRepositoryToken(BloodUnitEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCompatibleBloodTypes', () => {
    it('should return compatible blood types for O-', () => {
      const result = service.getCompatibleBloodTypes('O-');
      expect(result).toEqual(['O-']);
    });

    it('should return compatible blood types for A+', () => {
      const result = service.getCompatibleBloodTypes('A+');
      expect(result).toContain('O-');
      expect(result).toContain('O+');
      expect(result).toContain('A-');
      expect(result).toContain('A+');
    });

    it('should throw error for invalid blood type', () => {
      expect(() => service.getCompatibleBloodTypes('X+')).toThrow(
        'Invalid blood type: X+',
      );
    });
  });

  describe('getDonatableBloodTypes', () => {
    it('should return donatable blood types for O-', () => {
      const result = service.getDonatableBloodTypes('O-');
      expect(result).toContain('O-');
      expect(result).toContain('O+');
      expect(result).toContain('A-');
      expect(result).toContain('A+');
      expect(result).toContain('B-');
      expect(result).toContain('B+');
      expect(result).toContain('AB-');
      expect(result).toContain('AB+');
    });

    it('should throw error for invalid blood type', () => {
      expect(() => service.getDonatableBloodTypes('X+')).toThrow(
        'Invalid blood type: X+',
      );
    });
  });

  describe('findMatches', () => {
    it('should find matches for a blood request', async () => {
      mockBloodUnitRepository.find.mockResolvedValue([mockBloodUnit]);
      mockBloodUnitRepository.update.mockResolvedValue({});

      const result = await service.findMatches({
        requestId: 'req-1',
        hospitalId: 'hospital-1',
        bloodType: 'A+',
        quantityMl: 450,
        urgency: 'high',
        requiredBy: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      expect(result.requestId).toBe('req-1');
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.totalMatched).toBeGreaterThan(0);
    });

    it('should return empty matches if no units available', async () => {
      mockBloodUnitRepository.find.mockResolvedValue([]);

      const result = await service.findMatches({
        requestId: 'req-1',
        hospitalId: 'hospital-1',
        bloodType: 'A+',
        quantityMl: 450,
        urgency: 'high',
        requiredBy: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      expect(result.matches).toEqual([]);
      expect(result.totalMatched).toBe(0);
    });
  });

  describe('findMatchesForMultipleRequests', () => {
    it('should find matches for multiple requests', async () => {
      mockBloodUnitRepository.find.mockResolvedValue([mockBloodUnit]);
      mockBloodUnitRepository.update.mockResolvedValue({});

      const requests = [
        {
          requestId: 'req-1',
          hospitalId: 'hospital-1',
          bloodType: 'A+',
          quantityMl: 450,
          urgency: 'critical' as const,
          requiredBy: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        {
          requestId: 'req-2',
          hospitalId: 'hospital-2',
          bloodType: 'O+',
          quantityMl: 450,
          urgency: 'low' as const,
          requiredBy: new Date(Date.now() + 48 * 60 * 60 * 1000),
        },
      ];

      const result = await service.findMatchesForMultipleRequests(requests);

      expect(result.length).toBe(2);
      expect(result[0].requestId).toBe('req-1'); // Critical first
      expect(result[1].requestId).toBe('req-2');
    });
  });

  describe('calculateMatchingScore', () => {
    it('should calculate matching score correctly', async () => {
      const score = await service.calculateMatchingScore('A+', 'high', 7, 10);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should give higher score for exact match', async () => {
      const exactMatchScore = await service.calculateMatchingScore(
        'A+',
        'high',
        7,
      );

      const compatibleScore = await service.calculateMatchingScore(
        'O+',
        'high',
        7,
      );

      expect(exactMatchScore).toBeGreaterThan(compatibleScore);
    });

    it('should give higher score for urgent expiration', async () => {
      const urgentScore = await service.calculateMatchingScore('A+', 'high', 5);

      const normalScore = await service.calculateMatchingScore(
        'A+',
        'high',
        30,
      );

      expect(urgentScore).toBeGreaterThan(normalScore);
    });

    it('should give higher score for critical urgency', async () => {
      const criticalScore = await service.calculateMatchingScore(
        'A+',
        'critical',
        7,
      );

      const lowScore = await service.calculateMatchingScore('A+', 'low', 7);

      expect(criticalScore).toBeGreaterThan(lowScore);
    });
  });

  describe('getCompatibilityMatrix', () => {
    it('should return compatibility matrix', () => {
      const matrix = service.getCompatibilityMatrix();

      expect(matrix).toBeDefined();
      expect(matrix['O-']).toBeDefined();
      expect(matrix['O-'].canDonateTo).toContain('AB+');
      expect(matrix['AB+'].canReceiveFrom).toContain('O-');
    });
  });
});
