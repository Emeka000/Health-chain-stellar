import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  QueryRequestsDto,
  SortField,
  SortOrder,
} from '../dto/query-requests.dto';
import { BloodRequestItemEntity } from '../entities/blood-request-item.entity';
import { BloodRequestEntity } from '../entities/blood-request.entity';
import { BloodRequestStatus } from '../enums/blood-request-status.enum';

import { RequestQueryService } from './request-query.service';

describe('RequestQueryService', () => {
  let service: RequestQueryService;
  let bloodRequestRepository: Repository<BloodRequestEntity>;

  const mockBloodRequest: BloodRequestEntity = {
    id: 'req-1',
    requestNumber: 'BR-001',
    hospitalId: 'hospital-1',
    requiredBy: new Date(Date.now() + 24 * 60 * 60 * 1000),
    deliveryAddress: 'Test Address',
    notes: 'Test notes',
    status: BloodRequestStatus.PENDING,
    blockchainTxHash: null,
    createdByUserId: 'user-1',
    items: [
      {
        id: 'item-1',
        bloodBankId: 'bank-1',
        bloodType: 'A+',
        quantity: 2,
      },
    ] as BloodRequestItemEntity[],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as BloodRequestEntity;

  const mockBloodRequestRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockBloodRequestItemRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestQueryService,
        {
          provide: getRepositoryToken(BloodRequestEntity),
          useValue: mockBloodRequestRepository,
        },
        {
          provide: getRepositoryToken(BloodRequestItemEntity),
          useValue: mockBloodRequestItemRepository,
        },
      ],
    }).compile();

    service = module.get<RequestQueryService>(RequestQueryService);
    bloodRequestRepository = module.get<Repository<BloodRequestEntity>>(
      getRepositoryToken(BloodRequestEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('queryRequests', () => {
    it('should query requests with filters', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockBloodRequest], 1]),
      };
      mockBloodRequestRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );

      const queryDto: QueryRequestsDto = {
        status: BloodRequestStatus.PENDING,
        hospitalId: 'hospital-1',
        limit: 20,
        offset: 0,
        sortBy: SortField.CREATED_AT,
        sortOrder: SortOrder.DESC,
      };

      const result = await service.queryRequests(queryDto);

      expect(result.data).toEqual([mockBloodRequest]);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should apply text search filter', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockBloodRequest], 1]),
      };
      mockBloodRequestRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );

      const queryDto: QueryRequestsDto = {
        searchText: 'BR-001',
        limit: 20,
        offset: 0,
      };

      await service.queryRequests(queryDto);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should apply date range filter', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockBloodRequest], 1]),
      };
      mockBloodRequestRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );

      const queryDto: QueryRequestsDto = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
        limit: 20,
        offset: 0,
      };

      await service.queryRequests(queryDto);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
    });
  });

  describe('getRequestStatistics', () => {
    it('should return request statistics', async () => {
      mockBloodRequestRepository.find.mockResolvedValue([mockBloodRequest]);

      const result = await service.getRequestStatistics();

      expect(result.totalRequests).toBe(1);
      expect(result.pendingRequests).toBe(1);
      expect(result.requestsByBloodType['A+']).toBe(1);
    });

    it('should filter by hospital ID', async () => {
      mockBloodRequestRepository.find.mockResolvedValue([mockBloodRequest]);

      const result = await service.getRequestStatistics('hospital-1');

      expect(result.totalRequests).toBe(1);
    });

    it('should filter by date range', async () => {
      mockBloodRequestRepository.find.mockResolvedValue([mockBloodRequest]);

      const result = await service.getRequestStatistics(
        undefined,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
      );

      expect(result.totalRequests).toBe(1);
    });
  });

  describe('getSLAComplianceReport', () => {
    it('should return SLA compliance report', async () => {
      const fulfilledRequest = {
        ...mockBloodRequest,
        status: BloodRequestStatus.FULFILLED,
        updatedAt: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
      };
      mockBloodRequestRepository.find.mockResolvedValue([fulfilledRequest]);

      const result = await service.getSLAComplianceReport();

      expect(result.totalRequests).toBe(1);
      expect(result.onTimeFulfillments).toBe(1);
      expect(result.complianceRate).toBe(100);
    });

    it('should calculate late fulfillments', async () => {
      const lateRequest = {
        ...mockBloodRequest,
        status: BloodRequestStatus.FULFILLED,
        requiredBy: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        updatedAt: new Date(), // now (late)
      };
      mockBloodRequestRepository.find.mockResolvedValue([lateRequest]);

      const result = await service.getSLAComplianceReport();

      expect(result.totalRequests).toBe(1);
      expect(result.lateFulfillments).toBe(1);
      expect(result.complianceRate).toBe(0);
    });
  });

  describe('exportToCSV', () => {
    it('should export requests to CSV', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockBloodRequest], 1]),
      };
      mockBloodRequestRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );

      const queryDto: QueryRequestsDto = {
        limit: 20,
        offset: 0,
      };

      const result = await service.exportToCSV(queryDto);

      expect(result).toContain('Request Number');
      expect(result).toContain('BR-001');
    });
  });

  describe('exportToPDF', () => {
    it('should return placeholder for PDF export', async () => {
      const queryDto: QueryRequestsDto = {
        limit: 20,
        offset: 0,
      };

      const result = await service.exportToPDF(queryDto);

      expect(result).toBeInstanceOf(Buffer);
    });
  });
});
