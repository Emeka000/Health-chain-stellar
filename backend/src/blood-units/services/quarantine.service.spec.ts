import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';

import { QuarantineService } from './quarantine.service';
import { BloodStatusService } from '../blood-status.service';
import { PolicyCenterService } from '../../policy-center/policy-center.service';
import { ApprovalService } from '../../approvals/approval.service';
import { FileMetadataService } from '../../file-metadata/file-metadata.service';
import { BloodUnit } from '../entities/blood-unit.entity';
import { QuarantineCase } from '../entities/quarantine-case.entity';
import { CreateQuarantineCaseDto } from '../dto/quarantine.dto';
import { QuarantineTriggerSource, QuarantineReasonCode } from '../enums/quarantine.enums';
import { BloodStatus } from '../enums/blood-status.enum';

describe('QuarantineService', () => {
  let service: QuarantineService;
  let quarantineRepository: jest.Mocked<Repository<QuarantineCase>>;
  let bloodUnitRepository: jest.Mocked<Repository<BloodUnit>>;
  let bloodStatusService: jest.Mocked<BloodStatusService>;
  let policyCenterService: jest.Mocked<PolicyCenterService>;
  let approvalService: jest.Mocked<ApprovalService>;
  let fileMetadataService: jest.Mocked<FileMetadataService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuarantineService,
        {
          provide: getRepositoryToken(QuarantineCase),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(BloodUnit),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: BloodStatusService,
          useValue: {
            updateStatus: jest.fn(),
          },
        },
        {
          provide: PolicyCenterService,
          useValue: {
            getDefaultRules: jest.fn(),
          },
        },
        {
          provide: ApprovalService,
          useValue: {
            createRequest: jest.fn(),
          },
        },
        {
          provide: FileMetadataService,
          useValue: {
            register: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<QuarantineService>(QuarantineService);
    quarantineRepository = module.get(getRepositoryToken(QuarantineCase));
    bloodUnitRepository = module.get(getRepositoryToken(BloodUnit));
    bloodStatusService = module.get(BloodStatusService);
    policyCenterService = module.get(PolicyCenterService);
    approvalService = module.get(ApprovalService);
    fileMetadataService = module.get(FileMetadataService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createCase', () => {
    const mockDto: CreateQuarantineCaseDto = {
      bloodUnitId: 'unit-123',
      triggerSource: QuarantineTriggerSource.TEMPERATURE_BREACH,
      reasonCode: QuarantineReasonCode.STORAGE_ANOMALY,
      evidence: [
        {
          type: 'temperature_log',
          fileId: 'file-123',
          description: 'Temperature log',
        },
      ],
    };

    const mockUnit: BloodUnit = {
      id: 'unit-123',
      status: BloodStatus.AVAILABLE,
    } as BloodUnit;

    const mockPolicy = {
      quarantine: {
        triggerMatrix: {
          temperature_breach: {
            enabled: true,
            autoQuarantine: true,
            requiredEvidence: ['temperature_log'],
          },
        },
        evidenceRequirements: {
          minimumEvidenceCount: 1,
          allowedEvidenceTypes: ['temperature_log', 'document'],
          maxEvidenceSizeMb: 10,
        },
      },
    };

    beforeEach(() => {
      bloodUnitRepository.findOne.mockResolvedValue(mockUnit);
      quarantineRepository.findOne.mockResolvedValue(null);
      policyCenterService.getDefaultRules.mockReturnValue(mockPolicy);
      fileMetadataService.register.mockResolvedValue({} as any);
      bloodStatusService.updateStatus.mockResolvedValue({} as any);
      quarantineRepository.create.mockReturnValue({} as QuarantineCase);
      quarantineRepository.save.mockResolvedValue({} as QuarantineCase);
    });

    it('should create a quarantine case successfully', async () => {
      const result = await service.createCase(mockDto);

      expect(result.success).toBe(true);
      expect(bloodStatusService.updateStatus).toHaveBeenCalledWith(
        'unit-123',
        { status: BloodStatus.QUARANTINED, reason: 'STORAGE_ANOMALY' },
        undefined,
      );
    });

    it('should throw NotFoundException if blood unit not found', async () => {
      bloodUnitRepository.findOne.mockResolvedValue(null);

      await expect(service.createCase(mockDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if active quarantine exists', async () => {
      quarantineRepository.findOne.mockResolvedValue({ active: true } as QuarantineCase);

      await expect(service.createCase(mockDto)).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if evidence requirements not met', async () => {
      const invalidDto = { ...mockDto, evidence: [] };

      await expect(service.createCase(invalidDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if trigger not enabled', async () => {
      const disabledPolicy = {
        ...mockPolicy,
        quarantine: {
          ...mockPolicy.quarantine,
          triggerMatrix: {
            temperature_breach: { enabled: false },
          },
        },
      };
      policyCenterService.getDefaultRules.mockReturnValue(disabledPolicy);

      await expect(service.createCase(mockDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('createCase - conflicting signals', () => {
    it('should handle repeated quarantine attempts gracefully', async () => {
      const mockDto: CreateQuarantineCaseDto = {
        bloodUnitId: 'unit-123',
        triggerSource: QuarantineTriggerSource.TEMPERATURE_BREACH,
        reasonCode: QuarantineReasonCode.STORAGE_ANOMALY,
        evidence: [{ type: 'temperature_log', fileId: 'file-123' }],
      };

      const mockUnit: BloodUnit = {
        id: 'unit-123',
        status: BloodStatus.QUARANTINED, // Already quarantined
      } as BloodUnit;

      const mockPolicy = {
        quarantine: {
          triggerMatrix: {
            temperature_breach: {
              enabled: true,
              autoQuarantine: true,
              requiredEvidence: ['temperature_log'],
            },
          },
          evidenceRequirements: {
            minimumEvidenceCount: 1,
            allowedEvidenceTypes: ['temperature_log'],
            maxEvidenceSizeMb: 10,
          },
        },
      };

      bloodUnitRepository.findOne.mockResolvedValue(mockUnit);
      quarantineRepository.findOne.mockResolvedValue(null); // No active case
      policyCenterService.getDefaultRules.mockReturnValue(mockPolicy);
      fileMetadataService.register.mockResolvedValue({} as any);
      // bloodStatusService.updateStatus should not be called since unit is already quarantined
      quarantineRepository.create.mockReturnValue({} as QuarantineCase);
      quarantineRepository.save.mockResolvedValue({} as QuarantineCase);

      const result = await service.createCase(mockDto);

      expect(result.success).toBe(true);
      expect(bloodStatusService.updateStatus).not.toHaveBeenCalled(); // Should not update status
    });

    it('should prevent duplicate active quarantine cases', async () => {
      const mockDto: CreateQuarantineCaseDto = {
        bloodUnitId: 'unit-123',
        triggerSource: QuarantineTriggerSource.TEMPERATURE_BREACH,
        reasonCode: QuarantineReasonCode.STORAGE_ANOMALY,
        evidence: [{ type: 'temperature_log', fileId: 'file-123' }],
      };

      const mockUnit: BloodUnit = {
        id: 'unit-123',
        status: BloodStatus.AVAILABLE,
      } as BloodUnit;

      const existingCase: QuarantineCase = {
        id: 'existing-case',
        bloodUnitId: 'unit-123',
        active: true,
      } as QuarantineCase;

      bloodUnitRepository.findOne.mockResolvedValue(mockUnit);
      quarantineRepository.findOne.mockResolvedValue(existingCase);

      await expect(service.createCase(mockDto)).rejects.toThrow(ConflictException);
      expect(quarantineRepository.save).not.toHaveBeenCalled();
    });

    it('should handle multiple trigger sources for same unit', async () => {
      const tempBreachDto: CreateQuarantineCaseDto = {
        bloodUnitId: 'unit-123',
        triggerSource: QuarantineTriggerSource.TEMPERATURE_BREACH,
        reasonCode: QuarantineReasonCode.STORAGE_ANOMALY,
        evidence: [{ type: 'temperature_log', fileId: 'temp-123' }],
      };

      const contaminationDto: CreateQuarantineCaseDto = {
        bloodUnitId: 'unit-123',
        triggerSource: QuarantineTriggerSource.ANOMALY_DETECTION,
        reasonCode: QuarantineReasonCode.CONTAMINATION_SUSPECTED,
        evidence: [{ type: 'lab_report', fileId: 'lab-123' }],
      };

      const mockUnit: BloodUnit = {
        id: 'unit-123',
        status: BloodStatus.AVAILABLE,
      } as BloodUnit;

      const mockPolicy = {
        quarantine: {
          triggerMatrix: {
            temperature_breach: {
              enabled: true,
              autoQuarantine: true,
              requiredEvidence: ['temperature_log'],
            },
            anomaly_detection: {
              enabled: true,
              autoQuarantine: true,
              requiredEvidence: ['lab_report'],
            },
          },
          evidenceRequirements: {
            minimumEvidenceCount: 1,
            allowedEvidenceTypes: ['temperature_log', 'lab_report'],
            maxEvidenceSizeMb: 10,
          },
        },
      };

      bloodUnitRepository.findOne.mockResolvedValue(mockUnit);
      quarantineRepository.findOne.mockResolvedValue(null);
      policyCenterService.getDefaultRules.mockReturnValue(mockPolicy);
      fileMetadataService.register.mockResolvedValue({} as any);
      bloodStatusService.updateStatus.mockResolvedValue({} as any);
      quarantineRepository.create.mockReturnValue({} as QuarantineCase);
      quarantineRepository.save.mockResolvedValue({} as QuarantineCase);

      // First quarantine should succeed
      const result1 = await service.createCase(tempBreachDto);
      expect(result1.success).toBe(true);

      // Second quarantine should fail due to active case
      quarantineRepository.findOne.mockResolvedValue({ active: true } as QuarantineCase);
      await expect(service.createCase(contaminationDto)).rejects.toThrow(ConflictException);
    });
  });