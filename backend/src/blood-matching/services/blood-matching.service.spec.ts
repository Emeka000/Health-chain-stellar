import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';

import { BloodRequestItemEntity } from '../../blood-requests/entities/blood-request-item.entity';
import { BloodRequestEntity } from '../../blood-requests/entities/blood-request.entity';
import { BloodUnit } from '../../blood-units/entities/blood-unit.entity';
import { InventoryStockEntity } from '../../inventory/entities/inventory-stock.entity';
import { BloodCompatibilityEngine } from '../compatibility/blood-compatibility.engine';

import { BloodMatchingService } from './blood-matching.service';

describe('BloodMatchingService', () => {
  let service: BloodMatchingService;

  const mockBloodUnit = {
    id: 'unit-1',
    unitCode: 'UNIT-001',
    bloodType: 'A+',
    status: 'available',
    component: 'whole_blood',
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
  };

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

  const mockQueryRunnerManager = {
    find: jest.fn(),
    update: jest.fn(),
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: mockQueryRunnerManager,
  };

  const mockDataSource = {
    createQueryRunner: jest.fn(() => mockQueryRunner),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BloodMatchingService,
        BloodCompatibilityEngine,
        {
          provide: getRepositoryToken(BloodUnit),
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
        {
          provide: getDataSourceToken(),
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<BloodMatchingService>(BloodMatchingService);
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
      mockQueryRunnerManager.find.mockResolvedValue([mockBloodUnit]);
      mockQueryRunnerManager.update.mockResolvedValue({ affected: 1 });

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
      mockQueryRunnerManager.find.mockResolvedValue([]);

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
      mockQueryRunnerManager.find.mockResolvedValue([mockBloodUnit]);
      mockQueryRunnerManager.update.mockResolvedValue({ affected: 1 });

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

      expect(exactMatchScore).toBeGreaterThanOrEqual(compatibleScore);
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

  describe('isBloodTypeCompatible', () => {
    it('should return true for exact match', () => {
      expect(service.isBloodTypeCompatible('A+', 'A+')).toBe(true);
    });

    it('should return true for compatible donor/recipient pair', () => {
      expect(service.isBloodTypeCompatible('O-', 'A+')).toBe(true);
    });

    it('should return false for incompatible donor/recipient pair', () => {
      expect(service.isBloodTypeCompatible('A+', 'O-')).toBe(false);
    });
  });

  describe('getCompatibilityMatrix', () => {
    it('should return a matrix covering all blood types', () => {
      const matrix = service.getCompatibilityMatrix();

      expect(Object.keys(matrix).length).toBe(8);
      expect(matrix['O-']).toContain('O-');
      expect(matrix['A+']).toContain('O-');
    });
  });

  describe('getDaysUntilExpiration', () => {
    it('should return positive days for a future expiration', () => {
      const days = service.getDaysUntilExpiration(
        new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      );

      expect(days).toBeGreaterThanOrEqual(9);
      expect(days).toBeLessThanOrEqual(10);
    });

    it('should return zero or negative days for an expired unit', () => {
      const days = service.getDaysUntilExpiration(
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      );

      expect(days).toBeLessThanOrEqual(0);
    });
  });

  describe('calculateDistance', () => {
    it('should return zero distance for identical coordinates', () => {
      expect(service.calculateDistance(0, 0, 0, 0)).toBe(0);
    });

    it('should return a positive distance for distinct coordinates', () => {
      const distance = service.calculateDistance(0, 0, 1, 1);

      expect(distance).toBeGreaterThan(0);
    });
  });

  describe('determineMatchType', () => {
    it('should classify an exact blood type match', () => {
      expect(service.determineMatchType('A+', 'A+')).toBe('exact');
    });

    it('should classify a compatible but non-exact match', () => {
      expect(service.determineMatchType('O-', 'A+')).toBe('compatible');
    });
  });

  describe('calculateMatchScore', () => {
    it('should return a bounded score', () => {
      const score = service.calculateMatchScore(mockBloodUnit as any, {
        requestId: 'req-1',
        hospitalId: 'hospital-1',
        bloodType: 'A+',
        quantityMl: 450,
        urgency: 'high',
        requiredBy: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('scoreMatches', () => {
    it('should score and sort matches in descending order', () => {
      const request = {
        requestId: 'req-1',
        hospitalId: 'hospital-1',
        bloodType: 'A+',
        quantityMl: 450,
        urgency: 'high' as const,
        requiredBy: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      const scored = service.scoreMatches([mockBloodUnit as any], request);

      expect(scored.length).toBe(1);
      expect(scored[0].score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('selectBestMatches', () => {
    it('should select matches that satisfy the requested quantity', () => {
      const request = {
        requestId: 'req-1',
        hospitalId: 'hospital-1',
        bloodType: 'A+',
        quantityMl: 450,
        urgency: 'high' as const,
        requiredBy: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      const scored = service.scoreMatches([mockBloodUnit as any], request);
      const selected = service.selectBestMatches(scored, request);

      expect(selected.length).toBeGreaterThan(0);
    });
  });
});
