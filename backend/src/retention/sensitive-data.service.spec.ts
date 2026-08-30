import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { LocationHistoryEntity } from '../location-history/entities/location-history.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { RiderEntity } from '../riders/entities/rider.entity';

import { DataRedactionEntity, RedactionStatus } from './entities/data-redaction.entity';
import { RetentionPolicyEntity } from './entities/retention-policy.entity';
import { SensitiveDataService } from './sensitive-data.service';

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn((v) => Promise.resolve(v)),
  update: jest.fn(),
});

describe('SensitiveDataService', () => {
  let service: SensitiveDataService;
  let dataRedactionRepo: ReturnType<typeof mockRepo>;
  let bloodUnitRepo: ReturnType<typeof mockRepo>;
  let riderRepo: ReturnType<typeof mockRepo>;
  let organizationRepo: ReturnType<typeof mockRepo>;
  let locationHistoryRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    dataRedactionRepo = mockRepo();
    bloodUnitRepo = mockRepo();
    riderRepo = mockRepo();
    organizationRepo = mockRepo();
    locationHistoryRepo = mockRepo();

    const module = await Test.createTestingModule({
      providers: [
        SensitiveDataService,
        { provide: getRepositoryToken(RetentionPolicyEntity), useValue: mockRepo() },
        { provide: getRepositoryToken(DataRedactionEntity), useValue: dataRedactionRepo },
        { provide: getRepositoryToken(BloodUnit), useValue: bloodUnitRepo },
        { provide: getRepositoryToken(RiderEntity), useValue: riderRepo },
        { provide: getRepositoryToken(OrganizationEntity), useValue: organizationRepo },
        { provide: getRepositoryToken(LocationHistoryEntity), useValue: locationHistoryRepo },
      ],
    }).compile();

    service = module.get(SensitiveDataService);
  });

  describe('purgeUserData', () => {
    it('removes all PII fields for completed redactions tied to the user', async () => {
      const userId = 'user-abc';
      dataRedactionRepo.find.mockResolvedValue([
        {
          entityType: 'blood_unit',
          entityId: 'bu-1',
          fieldName: 'donorId',
          status: RedactionStatus.COMPLETED,
        },
        {
          entityType: 'rider',
          entityId: 'rider-1',
          fieldName: 'identityDocumentUrl',
          status: RedactionStatus.COMPLETED,
        },
        {
          entityType: 'organization',
          entityId: 'org-1',
          fieldName: 'licenseDocumentPath',
          status: RedactionStatus.COMPLETED,
        },
        {
          entityType: 'location_history',
          entityId: 'loc-1',
          fieldName: 'latitude',
          status: RedactionStatus.COMPLETED,
        },
      ]);

      await service.purgeUserData(userId);

      expect(dataRedactionRepo.find).toHaveBeenCalledWith({
        where: { executedByUserId: userId, status: RedactionStatus.COMPLETED },
      });
      expect(bloodUnitRepo.update).toHaveBeenCalledWith('bu-1', { donorId: null });
      expect(riderRepo.update).toHaveBeenCalledWith('rider-1', {
        identityDocumentUrl: null,
      });
      expect(organizationRepo.update).toHaveBeenCalledWith('org-1', {
        licenseDocumentPath: null,
      });
      expect(locationHistoryRepo.update).toHaveBeenCalledWith('loc-1', { latitude: null });
    });

    it('does nothing when no redactions exist for the user', async () => {
      dataRedactionRepo.find.mockResolvedValue([]);

      await service.purgeUserData('user-none');

      expect(bloodUnitRepo.update).not.toHaveBeenCalled();
      expect(riderRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('anonymiseRecord', () => {
    it('replaces BloodUnit identifying fields with anonymised values', async () => {
      const entity = Object.assign(new BloodUnit(), {
        id: 'bu-1',
        donorId: 'donor-real',
        storageLocation: 'Fridge A',
        testResults: { hiv: 'negative' },
      });

      await service.anonymiseRecord(entity);

      expect(bloodUnitRepo.update).toHaveBeenCalledWith(
        'bu-1',
        expect.objectContaining({
          donorId: expect.stringMatching(/^ANON-/),
          storageLocation: '[ANONYMIZED]',
          testResults: { anonymized: true },
        }),
      );
    });

    it('replaces RiderEntity identifying fields with anonymised values', async () => {
      const entity = Object.assign(new RiderEntity(), {
        id: 'rider-1',
        latitude: 6.45,
        longitude: 3.39,
        identityDocumentUrl: 'https://docs/id.pdf',
        vehicleDocumentUrl: 'https://docs/vehicle.pdf',
      });

      await service.anonymiseRecord(entity);

      expect(riderRepo.update).toHaveBeenCalledWith('rider-1', {
        latitude: 0,
        longitude: 0,
        identityDocumentUrl: '[ANONYMIZED]',
        vehicleDocumentUrl: '[ANONYMIZED]',
      });
    });

    it('throws for invalid entity', async () => {
      await expect(service.anonymiseRecord(null)).rejects.toThrow(
        'Invalid entity for anonymization',
      );
    });

    it('throws for unknown entity type', async () => {
      await expect(
        service.anonymiseRecord({ id: 'x-1', constructor: { name: 'UnknownEntity' } }),
      ).rejects.toThrow('Unknown entity type for anonymization');
    });
  });
});
