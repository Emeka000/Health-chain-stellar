import { Test, TestingModule } from '@nestjs/testing';
import { BloodMatchingController } from './blood-matching.controller';
import { BloodMatchingService } from '../services/blood-matching.service';
import { BloodType } from '../../blood-requests/entities/blood-request.entity';
import { UrgencyLevel } from '../../blood-requests/entities/blood-request.entity';

describe('BloodMatchingController', () => {
  let controller: BloodMatchingController;
  let service: jest.Mocked<BloodMatchingService>;

  const mockMatchResult = {
    requestId: 'req-1',
    matches: [],
    totalMatches: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BloodMatchingController],
      providers: [
        {
          provide: BloodMatchingService,
          useValue: {
            matchSingle: jest.fn().mockResolvedValue(mockMatchResult),
            matchBatch: jest.fn().mockResolvedValue([mockMatchResult]),
          },
        },
      ],
    }).compile();

    controller = module.get<BloodMatchingController>(BloodMatchingController);
    service = module.get(BloodMatchingService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('matchSingle', () => {
    it('should delegate a single match request to the service', async () => {
      const dto = {
        bloodType: BloodType.O_POSITIVE,
        urgency: UrgencyLevel.HIGH,
        quantityMl: 450,
      };

      const result = await controller.matchSingle(dto as any);

      expect(service.matchSingle).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockMatchResult);
    });
  });

  describe('matchBatch', () => {
    it('should delegate a batch of match requests to the service', async () => {
      const dtos = [
        {
          bloodType: BloodType.O_POSITIVE,
          urgency: UrgencyLevel.HIGH,
          quantityMl: 450,
        },
        {
          bloodType: BloodType.A_NEGATIVE,
          urgency: UrgencyLevel.LOW,
          quantityMl: 300,
        },
      ];

      const result = await controller.matchBatch(dtos as any);

      expect(service.matchBatch).toHaveBeenCalledWith(dtos);
      expect(result).toEqual([mockMatchResult]);
    });
  });
});
