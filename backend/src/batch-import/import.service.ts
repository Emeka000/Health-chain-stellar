import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InventoryEntity } from '../../inventory/entities/inventory.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { OrganizationVerificationStatus } from '../../organizations/enums/organization-verification-status.enum';
import { RiderEntity } from '../../riders/entities/rider.entity';
import { RiderStatus } from '../../riders/enums/rider-status.enum';
import { ActivityType } from '../../user-activity/enums/activity-type.enum';
import { UserActivityService } from '../../user-activity/user-activity.service';
import { ImportBatchEntity } from '../entities/import-batch.entity';
import { ImportStagingRowEntity } from '../entities/import-staging-row.entity';
import {
  ImportBatchStatus,
  ImportEntityType,
  ImportRowStatus,
} from '../enums/import.enum';
import { ImportValidationService } from '../import-validation.service';
import { FileMetadataService } from '../../file-metadata/file-metadata.service';
import { FileOwnerType } from '../../file-metadata/entities/file-metadata.entity';

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(ImportBatchEntity)
    private readonly batchRepo: Repository<ImportBatchEntity>,
    @InjectRepository(ImportStagingRowEntity)
    private readonly rowRepo: Repository<ImportStagingRowEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(RiderEntity)
    private readonly riderRepo: Repository<RiderEntity>,
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    private readonly validationService: ImportValidationService,
    private readonly activityService: UserActivityService,
    private readonly fileMetadata: FileMetadataService,
  ) {}

  /** Parse CSV buffer → stage rows → return preview */
  async stageImport(
    csvBuffer: Buffer,
    entityType: ImportEntityType,
    importedBy: string,
    filename: string | null,
  ): Promise<ImportBatchEntity> {
    const rows = this.parseCsv(csvBuffer);
    if (rows.length === 0) throw new BadRequestException('CSV file is empty');

    const stagingRows: Partial<ImportStagingRowEntity>[] = [];
    let validCount = 0;
    let invalidCount = 0;

    // Dedup sets scoped to this batch
    const seenNames = new Set<string>();
    const seenLicenses = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let errors: string[] = [];

      if (entityType === ImportEntityType.ORGANIZATION) {
        errors = await this.validationService.validateOrganizationRow(row, seenNames);
      } else if (entityType === ImportEntityType.RIDER) {
        errors = this.validationService.validateRiderRow(row, seenLicenses);
      } else {
        errors = this.validationService.validateInventoryRow(row);
      }

      const status = errors.length === 0 ? ImportRowStatus.VALID : ImportRowStatus.INVALID;
      if (status === ImportRowStatus.VALID) validCount++;
      else invalidCount++;

      stagingRows.push({ rowIndex: i, data: row, status, errors: errors.length ? errors : null, committedId: null });
    }

    const batch = await this.batchRepo.save(
      this.batchRepo.create({
        entityType,
        status: ImportBatchStatus.STAGED,
        totalRows: rows.length,
        validRows: validCount,
        invalidRows: invalidCount,
        importedBy,
        originalFilename: filename,
      }),
    );

    await this.fileMetadata.register({
      ownerType: FileOwnerType.BATCH_IMPORT,
      ownerId: batch.id,
      storagePath: `batch-import/${batch.id}`,
      originalFilename: filename ?? undefined,
      contentType: 'text/csv',
      sizeBytes: csvBuffer.length,
    });

    await this.rowRepo.save(
      stagingRows.map((r) => this.rowRepo.create({ ...r, batchId: batch.id })),
    );

    return batch;
  }

  /** Commit valid rows (or a subset of row IDs) from a staged batch */
  async commitBatch(
    batchId: string,
    importedBy: string,
    rowIds?: string[],
  ): Promise<{ committed: number }> {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    if (batch.status === ImportBatchStatus.COMMITTED) {
      throw new BadRequestException('Batch already committed');
    }

    const where: Partial<ImportStagingRowEntity> & { batchId: string; status: ImportRowStatus } = {
      batchId,
      status: ImportRowStatus.VALID,
    };
    let rows = await this.rowRepo.find({ where });

    if (rowIds?.length) {
      rows = rows.filter((r) => rowIds.includes(r.id));
    }

    let committed = 0;
    try {
      for (const row of rows) {
        const id = await this.commitRow(batch.entityType, row.data);
        await this.rowRepo.update(row.id, { committedId: id });
        committed++;
      }
    } catch (err) {
      await this.fileMetadata.markOrphaned(`batch-import/${batchId}`);
      throw err;
    }

    await this.batchRepo.update(batchId, { status: ImportBatchStatus.COMMITTED });

    await this.activityService.logActivity({
      userId: importedBy,
      activityType: ActivityType.BATCH_IMPORT,
      description: `Batch import committed: ${committed} ${batch.entityType} records`,
      metadata: { batchId, entityType: batch.entityType, committed, filename: batch.originalFilename },
    });

    return { committed };
  }

  async getBatch(batchId: string) {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    const rows = await this.rowRepo.find({ where: { batchId }, order: { rowIndex: 'ASC' } });
    return { batch, rows };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async commitRow(
    entityType: ImportEntityType,
    data: Record<string, unknown>,
  ): Promise<string> {
    if (entityType === ImportEntityType.ORGANIZATION) {
      const org = await this.orgRepo.save(
        this.orgRepo.create({
          name: data['name'] as string,
          type: data['type'] as any,
          email: (data['email'] as string) ?? null,
          phone: (data['phone'] as string) ?? null,
          address: (data['address'] as string) ?? null,
          city: (data['city'] as string) ?? null,
          country: (data['country'] as string) ?? null,
          latitude: data['latitude'] ? Number(data['latitude']) : null,
          longitude: data['longitude'] ? Number(data['longitude']) : null,
          status: OrganizationVerificationStatus.PENDING_VERIFICATION,
          licenseDocumentPath: '',
          certificateDocumentPath: '',
          rating: 0,
          reviewCount: 0,
          isActive: true,
        }),
      );
      return org.id;
    }

    if (entityType === ImportEntityType.RIDER) {
      const rider = await this.riderRepo.save(
        this.riderRepo.create({
          userId: data['userId'] as string,
          vehicleType: data['vehicleType'] as any,
          vehicleNumber: data['vehicleNumber'] as string,
          licenseNumber: data['licenseNumber'] as string,
          latitude: data['latitude'] ? Number(data['latitude']) : null,
          longitude: data['longitude'] ? Number(data['longitude']) : null,
          status: RiderStatus.OFFLINE,
          isVerified: false,
          completedDeliveries: 0,
          cancelledDeliveries: 0,
          failedDeliveries: 0,
          rating: 0,
        }),
      );
      return rider.id;
    }

    // INVENTORY
    const inv = await this.inventoryRepo.save(
      this.inventoryRepo.create({
        bloodType: data['bloodType'] as string,
        region: data['region'] as string,
        quantity: Number(data['quantity']),
      }),
    );
    return inv.id;
  }

  /** Minimal CSV parser — handles quoted fields */
  private parseCsv(buffer: Buffer): Record<string, unknown>[] {
    const text = buffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return [];

    const headers = this.splitCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
      const values = this.splitCsvLine(line);
      return Object.fromEntries(headers.map((h, i) => [h.trim(), values[i]?.trim() ?? '']));
    });
  }

  private splitCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current); current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }
}
