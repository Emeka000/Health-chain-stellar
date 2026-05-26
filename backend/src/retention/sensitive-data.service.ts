import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';

import { RetentionPolicyEntity, DataCategory, RetentionAction } from './entities/retention-policy.entity';
import { DataRedactionEntity, RedactionStatus, SensitiveFieldType } from './entities/data-redaction.entity';

// Import entities for sensitive data
import { BloodUnit } from '../../blood-units/entities/blood-unit.entity';
import { RiderEntity } from '../../riders/entities/rider.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { LocationHistoryEntity } from '../../location-history/entities/location-history.entity';

interface SensitiveField {
  entityType: string;
  fieldName: string;
  fieldType: SensitiveFieldType;
  dataCategory: DataCategory;
  description: string;
}

@Injectable()
export class SensitiveDataService {
  private readonly logger = new Logger(SensitiveDataService.name);

  // Define sensitive fields classification
  private readonly sensitiveFields: SensitiveField[] = [
    // Blood Unit / Donor Data
    {
      entityType: 'blood_unit',
      fieldName: 'donorId',
      fieldType: SensitiveFieldType.TEXT,
      dataCategory: DataCategory.DONOR_DATA,
      description: 'Personal identifier of blood donor',
    },
    {
      entityType: 'blood_unit',
      fieldName: 'testResults',
      fieldType: SensitiveFieldType.JSON,
      dataCategory: DataCategory.MEDICAL_RECORDS,
      description: 'Medical test results and health data',
    },
    {
      entityType: 'blood_unit',
      fieldName: 'storageLocation',
      fieldType: SensitiveFieldType.TEXT,
      dataCategory: DataCategory.DELIVERY_EVIDENCE,
      description: 'Specific storage location details',
    },

    // Rider Data
    {
      entityType: 'rider',
      fieldName: 'latitude',
      fieldType: SensitiveFieldType.COORDINATES,
      dataCategory: DataCategory.RIDER_DATA,
      description: 'Real-time location tracking',
    },
    {
      entityType: 'rider',
      fieldName: 'longitude',
      fieldType: SensitiveFieldType.COORDINATES,
      dataCategory: DataCategory.RIDER_DATA,
      description: 'Real-time location tracking',
    },
    {
      entityType: 'rider',
      fieldName: 'identityDocumentUrl',
      fieldType: SensitiveFieldType.FILE_PATH,
      dataCategory: DataCategory.RIDER_DATA,
      description: 'Identity document files',
    },
    {
      entityType: 'rider',
      fieldName: 'vehicleDocumentUrl',
      fieldType: SensitiveFieldType.FILE_PATH,
      dataCategory: DataCategory.RIDER_DATA,
      description: 'Vehicle registration documents',
    },

    // Organization Data
    {
      entityType: 'organization',
      fieldName: 'verificationDocuments',
      fieldType: SensitiveFieldType.JSON,
      dataCategory: DataCategory.ORGANIZATION_DATA,
      description: 'Verification and compliance documents',
    },
    {
      entityType: 'organization',
      fieldName: 'licenseDocumentPath',
      fieldType: SensitiveFieldType.FILE_PATH,
      dataCategory: DataCategory.ORGANIZATION_DATA,
      description: 'Business license documents',
    },
    {
      entityType: 'organization',
      fieldName: 'certificateDocumentPath',
      fieldType: SensitiveFieldType.FILE_PATH,
      dataCategory: DataCategory.ORGANIZATION_DATA,
      description: 'Certification documents',
    },
    {
      entityType: 'organization',
      fieldName: 'rejectionReason',
      fieldType: SensitiveFieldType.TEXT,
      dataCategory: DataCategory.ORGANIZATION_DATA,
      description: 'Reasons for verification rejection',
    },

    // Location History
    {
      entityType: 'location_history',
      fieldName: 'latitude',
      fieldType: SensitiveFieldType.COORDINATES,
      dataCategory: DataCategory.LOCATION_HISTORY,
      description: 'Historical GPS location data',
    },
    {
      entityType: 'location_history',
      fieldName: 'longitude',
      fieldType: SensitiveFieldType.COORDINATES,
      dataCategory: DataCategory.LOCATION_HISTORY,
      description: 'Historical GPS location data',
    },
    {
      entityType: 'location_history',
      fieldName: 'accuracy',
      fieldType: SensitiveFieldType.TEXT,
      dataCategory: DataCategory.LOCATION_HISTORY,
      description: 'GPS accuracy and precision data',
    },
    {
      entityType: 'location_history',
      fieldName: 'speed',
      fieldType: SensitiveFieldType.TEXT,
      dataCategory: DataCategory.LOCATION_HISTORY,
      description: 'Movement speed data',
    },
    {
      entityType: 'location_history',
      fieldName: 'heading',
      fieldType: SensitiveFieldType.TEXT,
      dataCategory: DataCategory.LOCATION_HISTORY,
      description: 'Direction of movement',
    },
    {
      entityType: 'location_history',
      fieldName: 'altitude',
      fieldType: SensitiveFieldType.TEXT,
      dataCategory: DataCategory.LOCATION_HISTORY,
      description: 'Altitude data',
    },
  ];

  constructor(
    @InjectRepository(RetentionPolicyEntity)
    private readonly retentionPolicyRepository: Repository<RetentionPolicyEntity>,
    @InjectRepository(DataRedactionEntity)
    private readonly dataRedactionRepository: Repository<DataRedactionEntity>,
    @InjectRepository(BloodUnit)
    private readonly bloodUnitRepository: Repository<BloodUnit>,
    @InjectRepository(RiderEntity)
    private readonly riderRepository: Repository<RiderEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizationRepository: Repository<OrganizationEntity>,
    @InjectRepository(LocationHistoryEntity)
    private readonly locationHistoryRepository: Repository<LocationHistoryEntity>,
  ) {}

  /**
   * Get all sensitive fields classification
   */
  getSensitiveFields(): SensitiveField[] {
    return this.sensitiveFields;
  }

  /**
   * Get sensitive fields for a specific entity type
   */
  getSensitiveFieldsForEntity(entityType: string): SensitiveField[] {
    return this.sensitiveFields.filter(field => field.entityType === entityType);
  }

  /**
   * Get sensitive fields for a specific data category
   */
  getSensitiveFieldsForCategory(dataCategory: DataCategory): SensitiveField[] {
    return this.sensitiveFields.filter(field => field.dataCategory === dataCategory);
  }

  /**
   * Create default retention policies for sensitive data
   */
  async createDefaultRetentionPolicies(): Promise<void> {
    const defaultPolicies = [
      {
        dataCategory: DataCategory.DONOR_DATA,
        legalBasis: 'consent' as any,
        retentionPeriodDays: 365 * 5, // 5 years for donor data
        retentionAction: RetentionAction.ANONYMIZE,
        description: 'Blood donor personal information retention',
      },
      {
        dataCategory: DataCategory.RIDER_DATA,
        legalBasis: 'contract' as any,
        retentionPeriodDays: 365 * 3, // 3 years for rider data
        retentionAction: RetentionAction.ANONYMIZE,
        description: 'Rider location and identity data retention',
      },
      {
        dataCategory: DataCategory.ORGANIZATION_DATA,
        legalBasis: 'legal_obligation' as any,
        retentionPeriodDays: 365 * 7, // 7 years for organization compliance data
        retentionAction: RetentionAction.ANONYMIZE,
        description: 'Organization verification and compliance data',
      },
      {
        dataCategory: DataCategory.DELIVERY_EVIDENCE,
        legalBasis: 'contract' as any,
        retentionPeriodDays: 365 * 2, // 2 years for delivery evidence
        retentionAction: RetentionAction.ANONYMIZE,
        description: 'Delivery tracking and proof data',
      },
      {
        dataCategory: DataCategory.LOCATION_HISTORY,
        legalBasis: 'consent' as any,
        retentionPeriodDays: 90, // 90 days for detailed location history
        retentionAction: RetentionAction.DELETE,
        description: 'Real-time location tracking data',
      },
      {
        dataCategory: DataCategory.MEDICAL_RECORDS,
        legalBasis: 'legal_obligation' as any,
        retentionPeriodDays: 365 * 10, // 10 years for medical records
        retentionAction: RetentionAction.ANONYMIZE,
        description: 'Medical test results and health records',
      },
    ];

    for (const policy of defaultPolicies) {
      const existing = await this.retentionPolicyRepository.findOne({
        where: { dataCategory: policy.dataCategory, isActive: true },
      });

      if (!existing) {
        await this.retentionPolicyRepository.save(policy);
        this.logger.log(`Created retention policy for ${policy.dataCategory}`);
      }
    }
  }

  /**
   * Find data that needs redaction based on retention policies
   */
  async findDataNeedingRedaction(): Promise<DataRedactionEntity[]> {
    const policies = await this.retentionPolicyRepository.find({
      where: { isActive: true },
    });

    const redactions: DataRedactionEntity[] = [];

    for (const policy of policies) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - policy.retentionPeriodDays);

      const sensitiveFields = this.getSensitiveFieldsForCategory(policy.dataCategory);

      for (const field of sensitiveFields) {
        // Check for existing redactions to avoid duplicates
        const existingRedactions = await this.dataRedactionRepository.find({
          where: {
            entityType: field.entityType,
            fieldName: field.fieldName,
            status: In([RedactionStatus.PENDING, RedactionStatus.COMPLETED]),
          },
        });

        const existingEntityIds = existingRedactions.map(r => r.entityId);

        // Find entities that need redaction
        let entitiesNeedingRedaction: any[] = [];

        switch (field.entityType) {
          case 'blood_unit':
            entitiesNeedingRedaction = await this.bloodUnitRepository.find({
              where: {
                createdAt: LessThan(cutoffDate),
                id: existingEntityIds.length > 0 ? { $nin: existingEntityIds } : undefined,
              } as any,
              select: ['id'],
            });
            break;

          case 'rider':
            entitiesNeedingRedaction = await this.riderRepository.find({
              where: {
                createdAt: LessThan(cutoffDate),
                id: existingEntityIds.length > 0 ? { $nin: existingEntityIds } : undefined,
              } as any,
              select: ['id'],
            });
            break;

          case 'organization':
            entitiesNeedingRedaction = await this.organizationRepository.find({
              where: {
                createdAt: LessThan(cutoffDate),
                id: existingEntityIds.length > 0 ? { $nin: existingEntityIds } : undefined,
              } as any,
              select: ['id'],
            });
            break;

          case 'location_history':
            entitiesNeedingRedaction = await this.locationHistoryRepository.find({
              where: {
                createdAt: LessThan(cutoffDate),
                id: existingEntityIds.length > 0 ? { $nin: existingEntityIds } : undefined,
              } as any,
              select: ['id'],
            });
            break;
        }

        // Create redaction records
        for (const entity of entitiesNeedingRedaction) {
          const redaction = new DataRedactionEntity();
          redaction.entityType = field.entityType;
          redaction.entityId = entity.id;
          redaction.dataCategory = policy.dataCategory;
          redaction.fieldName = field.fieldName;
          redaction.fieldType = field.fieldType;
          redaction.retentionPolicyId = policy.id;
          redaction.redactionReason = `Retention policy: ${policy.retentionPeriodDays} days exceeded`;
          redaction.status = RedactionStatus.PENDING;

          redactions.push(redaction);
        }
      }
    }

    return redactions;
  }

  /**
   * Save redaction records to database
   */
  async saveRedactions(redactions: DataRedactionEntity[]): Promise<void> {
    if (redactions.length > 0) {
      await this.dataRedactionRepository.save(redactions);
      this.logger.log(`Saved ${redactions.length} redaction records`);
    }
  }

  /**
   * Execute redaction for pending records
   */
  async executeRedactions(userId?: string): Promise<{ processed: number; failed: number }> {
    const pendingRedactions = await this.dataRedactionRepository.find({
      where: { status: RedactionStatus.PENDING },
      take: 100, // Process in batches
    });

    let processed = 0;
    let failed = 0;

    for (const redaction of pendingRedactions) {
      try {
        await this.executeSingleRedaction(redaction, userId);
        processed++;
      } catch (error) {
        this.logger.error(`Failed to redact ${redaction.entityType}:${redaction.entityId}.${redaction.fieldName}`, error);
        redaction.status = RedactionStatus.FAILED;
        redaction.errorMessage = error.message;
        await this.dataRedactionRepository.save(redaction);
        failed++;
      }
    }

    return { processed, failed };
  }

  /**
   * Get all retention policies
   */
  async getRetentionPolicies() {
    return this.retentionPolicyRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get redaction audit log
   */
  async getRedactionAudit() {
    return this.dataRedactionRepository.find({
      order: { createdAt: 'DESC' },
      take: 1000, // Limit for admin UI
    });
  }

  private async executeSingleRedaction(redaction: DataRedactionEntity, userId?: string): Promise<void> {
    let originalValue: unknown;

    switch (redaction.entityType) {
      case 'blood_unit': {
        const unit = await this.bloodUnitRepository.findOne({ where: { id: redaction.entityId } });
        if (unit) {
          originalValue = (unit as any)[redaction.fieldName];
        }
        break;
      }
      case 'rider': {
        const rider = await this.riderRepository.findOne({ where: { id: redaction.entityId } });
        if (rider) {
          originalValue = (rider as any)[redaction.fieldName];
        }
        break;
      }
      case 'organization': {
        const org = await this.organizationRepository.findOne({ where: { id: redaction.entityId } });
        if (org) {
          originalValue = (org as any)[redaction.fieldName];
        }
        break;
      }
      case 'location_history': {
        const location = await this.locationHistoryRepository.findOne({ where: { id: redaction.entityId } });
        if (location) {
          originalValue = (location as any)[redaction.fieldName];
        }
        break;
      }
    }

    if (originalValue === null || originalValue === undefined) {
      redaction.status = RedactionStatus.COMPLETED;
      redaction.executedAt = new Date();
      redaction.executedByUserId = userId;
      await this.dataRedactionRepository.save(redaction);
      return;
    }

    redaction.originalValue = typeof originalValue === 'object' ? JSON.stringify(originalValue) : String(originalValue);

    let redactedValue: string;

    switch (redaction.fieldType) {
      case SensitiveFieldType.TEXT:
      case SensitiveFieldType.FILE_PATH:
        redactedValue = '[REDACTED]';
        break;
      case SensitiveFieldType.JSON:
        redactedValue = '{"redacted": true}';
        break;
      case SensitiveFieldType.COORDINATES:
        redactedValue = '0.000000';
        break;
      case SensitiveFieldType.MEDICAL_DATA:
        redactedValue = '[MEDICAL_DATA_REDACTED]';
        break;
      default:
        redactedValue = '[REDACTED]';
    }

    redaction.redactedValue = redactedValue;

    const updateData: any = {};
    updateData[redaction.fieldName] = redaction.fieldType === SensitiveFieldType.COORDINATES ? parseFloat(redactedValue) : redactedValue;

    switch (redaction.entityType) {
      case 'blood_unit':
        await this.bloodUnitRepository.update(redaction.entityId, updateData);
        break;
      case 'rider':
        await this.riderRepository.update(redaction.entityId, updateData);
        break;
      case 'organization':
        await this.organizationRepository.update(redaction.entityId, updateData);
        break;
      case 'location_history':
        await this.locationHistoryRepository.update(redaction.entityId, updateData);
        break;
    }

    redaction.status = RedactionStatus.COMPLETED;
    redaction.executedAt = new Date();
    redaction.executedByUserId = userId;

    await this.dataRedactionRepository.save(redaction);
  }
}