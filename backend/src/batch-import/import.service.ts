import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as crypto from 'crypto';

import { InventoryEntity } from '../inventory/entities/inventory.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationVerificationStatus } from '../organizations/enums/organization-verification-status.enum';
import { RiderEntity } from '../riders/entities/rider.entity';
import { RiderStatus } from '../riders/enums/rider-status.enum';
import { ActivityType } from '../user-activity/enums/activity-type.enum';
import { UserActivityService } from '../user-activity/user-activity.service';
import { FileMetadataService } from '../file-metadata/file-metadata.service';
import { FileOwnerType } from '../file-metadata/entities/file-metadata.entity';

import { ImportBatchEntity } from './entities/import-batch.entity';
import { ImportCommittedHashEntity } from './entities/import-committed-hash.entity';
import { ImportStagingRowEntity } from './entities/import-staging-row.entity';
import {
  ImportBatchStatus,
  ImportEntityType,
  ImportRowStatus,
  QuarantineReasonCode,
} from './enums/import.enum';
import { ImportValidationService } from './import-validation.service';

const DEFAULT_CHUNK_SIZE = 100;
const MAX_RETRIES = 3;

export interface ImportQualityReport {
  batchId: string;
  entityType: ImportEntityType;
  filename: string | null;
  status: ImportBatchStatus;
  totalRows: number;
  committedRows: number;
  quarantinedRows: number;
  duplicateRows: number;
  failedRows: number;
  acceptanceRate: number;
  rejectionRate: number;
  lastCommittedChunk: number | null;
  chunksTotal: number;
  resumable: boolean;
  quarantineBreakdown: Record<QuarantineReasonCode, number>;
  topErrors: Array<{ message: string; count: number }>;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    @InjectRepository(ImportBatchEntity)
    private readonly batchRepo: Repository<ImportBatchEntity>,
    @InjectRepository(ImportStagingRowEntity)
    private readonly rowRepo: Repository<ImportStagingRowEntity>,
    @InjectRepository(ImportCommittedHashEntity)
    private readonly hashRepo: Repository<ImportCommittedHashEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(RiderEntity)
    private readonly riderRepo: Repository<RiderEntity>,
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    private readonly validationService: ImportValidationService,
    private readonly activityService: UserActivityService,
    private readonly fileMetadata: FileMetadataService,
    private readonly dataSource: DataSource,
  ) { }

  // ── Stage ─────────────────────────────────────────────────────────────────

  /**
   * Parse CSV → validate all rows → stage with quarantine metadata.
   * Idempotent: if the same file (by SHA-256) was already staged/committed,
   * returns the original batch without re-processing.
   */
  async stageImport(
    csvBuffer: Buffer,
    entityType: ImportEntityType,
    importedBy: string,
    filename: string | null,
    chunkSize = DEFAULT_CHUNK_SIZE,
  ): Promise<ImportBatchEntity> {
    const fileHash = this.sha256(csvBuffer);

    // ── Idempotent file deduplication ──────────────────────────────────────
    const existing = await this.batchRepo.findOne({ where: { fileHash } });
    if (existing) {
      this.logger.warn(
        `Duplicate file submission detected (hash=${fileHash}), returning existing batch ${existing.id}`,
      );
      await this.batchRepo.update(existing.id, {
        status: ImportBatchStatus.DEDUPLICATED,
      });
      return this.batchRepo.findOne({ where: { id: existing.id } }) as Promise<ImportBatchEntity>;
    }

    const rows = this.parseCsv(csvBuffer);
    if (rows.length === 0) throw new BadRequestException('CSV file is empty');

    // ── Per-batch dedup sets ───────────────────────────────────────────────
    const seenNames = new Set<string>();
    const seenLicenses = new Set<string>();

    // ── Compute row hashes for cross-batch dedup ───────────────────────────
    const rowHashes = rows.map((r) => this.sha256(JSON.stringify(this.canonicalise(r))));
    const existingHashes = await this.hashRepo.find({
      where: { rowHash: In(rowHashes), entityType },
    });
    const committedHashSet = new Map(existingHashes.map((h) => [h.rowHash, h.committedId]));

    const stagingRows: Partial<ImportStagingRowEntity>[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowHash = rowHashes[i];
      const chunkIndex = Math.floor(i / chunkSize);

      // Cross-batch duplicate check
      if (committedHashSet.has(rowHash)) {
        duplicateCount++;
        stagingRows.push({
          rowIndex: i,
          data: row,
          status: ImportRowStatus.DUPLICATE,
          errors: [`Row already committed in a previous batch (committedId=${committedHashSet.get(rowHash)})`],
          quarantineReasonCode: QuarantineReasonCode.DUPLICATE_IN_DB,
          rowHash,
          chunkIndex,
          committedId: committedHashSet.get(rowHash) ?? null,
        });
        continue;
      }

      // Schema + business-rule validation
      let errors: string[] = [];
      let reasonCode: QuarantineReasonCode | null = null;

      if (entityType === ImportEntityType.ORGANIZATION) {
        errors = await this.validationService.validateOrganizationRow(row, seenNames);
      } else if (entityType === ImportEntityType.RIDER) {
        errors = this.validationService.validateRiderRow(row, seenLicenses);
      } else {
        errors = this.validationService.validateInventoryRow(row);
      }

      // Classify error type for quarantine reason code
      if (errors.length > 0) {
        reasonCode = this.classifyErrors(errors);
      }

      const status =
        errors.length === 0 ? ImportRowStatus.VALID : ImportRowStatus.QUARANTINED;

      if (status === ImportRowStatus.VALID) validCount++;
      else invalidCount++;

      stagingRows.push({
        rowIndex: i,
        data: row,
        status,
        errors: errors.length ? errors : null,
        quarantineReasonCode: reasonCode,
        rowHash,
        chunkIndex,
        committedId: null,
      });
    }

    // ── Persist batch + rows in a transaction ──────────────────────────────
    const batch = await this.dataSource.transaction(async (manager) => {
      const b = await manager.save(
        manager.create(ImportBatchEntity, {
          entityType,
          status: ImportBatchStatus.STAGED,
          totalRows: rows.length,
          validRows: validCount,
          invalidRows: invalidCount,
          quarantinedRows: invalidCount,
          duplicateRows: duplicateCount,
          committedRows: 0,
          failedRows: 0,
          importedBy,
          originalFilename: filename,
          fileHash,
          chunkSize,
          lastCommittedChunk: null,
          retryCount: 0,
        }),
      );

      await manager.save(
        stagingRows.map((r) => manager.create(ImportStagingRowEntity, { ...r, batchId: b.id })),
      );

      return b;
    });

    await this.fileMetadata.register({
      ownerType: FileOwnerType.BATCH_IMPORT,
      ownerId: batch.id,
      storagePath: `batch-import/${batch.id}`,
      originalFilename: filename ?? undefined,
      contentType: 'text/csv',
      sizeBytes: csvBuffer.length,
    });

    this.logger.log(
      `Batch ${batch.id} staged: total=${rows.length} valid=${validCount} ` +
      `quarantined=${invalidCount} duplicates=${duplicateCount}`,
    );

    return batch;
  }

  // ── Commit (chunked + resumable) ──────────────────────────────────────────

  /**
   * Commit valid rows in chunks with checkpoint tracking.
   * If interrupted, call again with the same batchId to resume from the
   * last successfully committed chunk.
   */
  async commitBatch(
    batchId: string,
    importedBy: string,
    rowIds?: string[],
  ): Promise<{ committed: number; skipped: number; failed: number; resumable: boolean }> {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

    if (batch.status === ImportBatchStatus.COMMITTED) {
      throw new ConflictException('Batch already fully committed');
    }
    if (batch.status === ImportBatchStatus.DEDUPLICATED) {
      throw new ConflictException('Batch was a duplicate file submission — nothing to commit');
    }

    // Mark as processing
    await this.batchRepo.update(batchId, { status: ImportBatchStatus.PROCESSING });

    // Load only VALID rows (not already committed/quarantined/duplicate)
    let validRows = await this.rowRepo.find({
      where: { batchId, status: ImportRowStatus.VALID },
      order: { rowIndex: 'ASC' },
    });

    if (rowIds?.length) {
      validRows = validRows.filter((r) => rowIds.includes(r.id));
    }

    if (validRows.length === 0) {
      await this.batchRepo.update(batchId, { status: ImportBatchStatus.REJECTED });
      return { committed: 0, skipped: 0, failed: 0, resumable: false };
    }

    // Group into chunks
    const chunkSize = batch.chunkSize;
    const chunks = this.chunkArray(validRows, chunkSize);
    const resumeFromChunk = batch.lastCommittedChunk !== null ? batch.lastCommittedChunk + 1 : 0;

    let totalCommitted = batch.committedRows;
    let totalFailed = batch.failedRows;
    let lastGoodChunk = batch.lastCommittedChunk;

    for (let ci = resumeFromChunk; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      let chunkCommitted = 0;

      try {
        await this.dataSource.transaction(async (manager) => {
          for (const row of chunk) {
            // Re-check cross-batch dedup inside transaction
            const existingHash = await manager.findOne(ImportCommittedHashEntity, {
              where: { rowHash: row.rowHash ?? '', entityType: batch.entityType },
            });

            if (existingHash) {
              await manager.update(ImportStagingRowEntity, row.id, {
                status: ImportRowStatus.DUPLICATE,
                committedId: existingHash.committedId,
                quarantineReasonCode: QuarantineReasonCode.DUPLICATE_IN_DB,
                errors: [`Duplicate detected at commit time (committedId=${existingHash.committedId})`],
              });
              continue;
            }

            const committedId = await this.commitRow(batch.entityType, row.data, manager);

            await manager.update(ImportStagingRowEntity, row.id, {
              status: ImportRowStatus.COMMITTED,
              committedId,
            });

            // Record hash to prevent future duplicates
            if (row.rowHash) {
              await manager.save(
                manager.create(ImportCommittedHashEntity, {
                  rowHash: row.rowHash,
                  entityType: batch.entityType,
                  committedId,
                  batchId,
                }),
              );
            }

            chunkCommitted++;
          }
        });

        totalCommitted += chunkCommitted;
        lastGoodChunk = ci;

        // Persist checkpoint after each successful chunk
        await this.batchRepo.update(batchId, {
          lastCommittedChunk: lastGoodChunk,
          committedRows: totalCommitted,
          retryCount: 0,
        });

        this.logger.log(
          `Batch ${batchId} chunk ${ci}/${chunks.length - 1} committed (${chunkCommitted} rows)`,
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        totalFailed += chunk.length;

        await this.batchRepo.update(batchId, {
          status: ImportBatchStatus.INTERRUPTED,
          lastError: errMsg,
          failedRows: totalFailed,
          retryCount: (batch.retryCount ?? 0) + 1,
        });

        // Quarantine the failed chunk rows
        await this.rowRepo.update(
          { batchId, chunkIndex: ci, status: ImportRowStatus.VALID },
          {
            status: ImportRowStatus.QUARANTINED,
            quarantineReasonCode: QuarantineReasonCode.COMMIT_ERROR,
            errors: [`Commit error: ${errMsg}`],
          },
        );

        this.logger.error(`Batch ${batchId} interrupted at chunk ${ci}: ${errMsg}`);

        return {
          committed: totalCommitted,
          skipped: 0,
          failed: totalFailed,
          resumable: true,
        };
      }
    }

    // All chunks done
    const finalStatus =
      totalCommitted > 0 ? ImportBatchStatus.COMMITTED : ImportBatchStatus.REJECTED;

    await this.batchRepo.update(batchId, {
      status: finalStatus,
      committedRows: totalCommitted,
      lastCommittedChunk: lastGoodChunk,
    });

    await this.activityService.logActivity({
      userId: importedBy,
      activityType: ActivityType.BATCH_IMPORT,
      description: `Batch import committed: ${totalCommitted} ${batch.entityType} records`,
      metadata: {
        batchId,
        entityType: batch.entityType,
        committed: totalCommitted,
        filename: batch.originalFilename,
      },
    });

    this.logger.log(
      `Batch ${batchId} fully committed: ${totalCommitted} rows, status=${finalStatus}`,
    );

    return { committed: totalCommitted, skipped: 0, failed: totalFailed, resumable: false };
  }

  // ── Resume ────────────────────────────────────────────────────────────────

  /**
   * Resume an interrupted batch from its last successful checkpoint.
   * Idempotent: already-committed rows are never re-processed.
   */
  async resumeBatch(
    batchId: string,
    importedBy: string,
  ): Promise<{ committed: number; skipped: number; failed: number; resumable: boolean }> {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

    if (batch.status !== ImportBatchStatus.INTERRUPTED) {
      throw new ConflictException(
        `Batch ${batchId} is not in INTERRUPTED state (current: ${batch.status})`,
      );
    }

    if ((batch.retryCount ?? 0) >= MAX_RETRIES) {
      throw new ConflictException(
        `Batch ${batchId} has exceeded the maximum retry limit (${MAX_RETRIES})`,
      );
    }

    this.logger.log(
      `Resuming batch ${batchId} from chunk ${(batch.lastCommittedChunk ?? -1) + 1}`,
    );

    // Re-mark quarantined-due-to-commit-error rows back to VALID so they get retried
    await this.rowRepo.update(
      {
        batchId,
        status: ImportRowStatus.QUARANTINED,
        quarantineReasonCode: QuarantineReasonCode.COMMIT_ERROR,
      },
      { status: ImportRowStatus.VALID, quarantineReasonCode: null, errors: null },
    );

    return this.commitBatch(batchId, importedBy);
  }

  // ── Quality Report ────────────────────────────────────────────────────────

  async getQualityReport(batchId: string): Promise<ImportQualityReport> {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

    const rows = await this.rowRepo.find({ where: { batchId } });

    // Quarantine breakdown by reason code
    const quarantineBreakdown = Object.values(QuarantineReasonCode).reduce(
      (acc, code) => ({ ...acc, [code]: 0 }),
      {} as Record<QuarantineReasonCode, number>,
    );

    const errorFrequency = new Map<string, number>();

    for (const row of rows) {
      if (row.quarantineReasonCode) {
        quarantineBreakdown[row.quarantineReasonCode] =
          (quarantineBreakdown[row.quarantineReasonCode] ?? 0) + 1;
      }
      if (row.errors) {
        for (const err of row.errors) {
          errorFrequency.set(err, (errorFrequency.get(err) ?? 0) + 1);
        }
      }
    }

    const topErrors = [...errorFrequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([message, count]) => ({ message, count }));

    const chunksTotal = Math.ceil(batch.totalRows / batch.chunkSize);
    const resumable = batch.status === ImportBatchStatus.INTERRUPTED;
    const acceptanceRate =
      batch.totalRows > 0
        ? Math.round((batch.committedRows / batch.totalRows) * 10000) / 100
        : 0;
    const rejectionRate =
      batch.totalRows > 0
        ? Math.round(
          ((batch.quarantinedRows + batch.failedRows) / batch.totalRows) * 10000,
        ) / 100
        : 0;

    return {
      batchId: batch.id,
      entityType: batch.entityType,
      filename: batch.originalFilename,
      status: batch.status,
      totalRows: batch.totalRows,
      committedRows: batch.committedRows,
      quarantinedRows: batch.quarantinedRows,
      duplicateRows: batch.duplicateRows,
      failedRows: batch.failedRows,
      acceptanceRate,
      rejectionRate,
      lastCommittedChunk: batch.lastCommittedChunk,
      chunksTotal,
      resumable,
      quarantineBreakdown,
      topErrors,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
  }

  // ── Batch + Row Queries ───────────────────────────────────────────────────

  async getBatch(batchId: string) {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    const rows = await this.rowRepo.find({ where: { batchId }, order: { rowIndex: 'ASC' } });
    return { batch, rows };
  }

  async getQuarantinedRows(batchId: string, reasonCode?: QuarantineReasonCode) {
    const where: Record<string, unknown> = { batchId, status: ImportRowStatus.QUARANTINED };
    if (reasonCode) where.quarantineReasonCode = reasonCode;
    return this.rowRepo.find({ where, order: { rowIndex: 'ASC' } });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async commitRow(
    entityType: ImportEntityType,
    data: Record<string, unknown>,
    manager: import('typeorm').EntityManager,
  ): Promise<string> {
    if (entityType === ImportEntityType.ORGANIZATION) {
      const org = await manager.save(
        manager.create(OrganizationEntity, {
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
      const rider = await manager.save(
        manager.create(RiderEntity, {
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
    const inv = await manager.save(
      manager.create(InventoryEntity, {
        bloodType: data['bloodType'] as string,
        region: data['region'] as string,
        quantity: Number(data['quantity']),
      }),
    );
    return inv.id;
  }

  private classifyErrors(errors: string[]): QuarantineReasonCode {
    const joined = errors.join(' ').toLowerCase();
    if (joined.includes('duplicate')) {
      return joined.includes('batch')
        ? QuarantineReasonCode.DUPLICATE_IN_BATCH
        : QuarantineReasonCode.DUPLICATE_IN_DB;
    }
    if (joined.includes('anomalous') || joined.includes('high')) {
      return QuarantineReasonCode.ANOMALOUS_VALUE;
    }
    if (
      joined.includes('required') ||
      joined.includes('invalid') ||
      joined.includes('format')
    ) {
      return QuarantineReasonCode.SCHEMA_VIOLATION;
    }
    return QuarantineReasonCode.BUSINESS_RULE_VIOLATION;
  }

  private sha256(input: Buffer | string): string {
    return crypto
      .createHash('sha256')
      .update(typeof input === 'string' ? input : input)
      .digest('hex');
  }

  /** Deterministic key ordering for stable row hashes. */
  private canonicalise(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => { acc[k] = obj[k]; return acc; }, {});
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
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
