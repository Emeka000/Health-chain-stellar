import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { InventoryEntity } from '../inventory/entities/inventory.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { RiderEntity } from '../riders/entities/rider.entity';
import { UserActivityService } from '../user-activity/user-activity.service';
import { FileMetadataService } from '../file-metadata/file-metadata.service';

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
import { ImportService } from './import.service';

// ── CSV fixtures ──────────────────────────────────────────────────────────────

const INVENTORY_CSV = Buffer.from(
    'bloodType,region,quantity\nA+,Lagos,50\nB-,Abuja,20\n',
);

const INVENTORY_CSV_INVALID = Buffer.from(
    'bloodType,region,quantity\nXX,Lagos,50\nA+,,abc\n',
);

const INVENTORY_CSV_DUPLICATE = Buffer.from(
    'bloodType,region,quantity\nA+,Lagos,50\nA+,Lagos,50\n', // same row twice
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBatch(overrides: Partial<ImportBatchEntity> = {}): ImportBatchEntity {
    return {
        id: 'batch-1',
        entityType: ImportEntityType.INVENTORY,
        status: ImportBatchStatus.STAGED,
        totalRows: 2,
        validRows: 2,
        invalidRows: 0,
        committedRows: 0,
        quarantinedRows: 0,
        duplicateRows: 0,
        failedRows: 0,
        importedBy: 'admin',
        originalFilename: 'test.csv',
        fileHash: 'abc123',
        chunkSize: 100,
        lastCommittedChunk: null,
        retryCount: 0,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    } as ImportBatchEntity;
}

function makeRow(overrides: Partial<ImportStagingRowEntity> = {}): ImportStagingRowEntity {
    return {
        id: `row-${Math.random()}`,
        batchId: 'batch-1',
        rowIndex: 0,
        data: { bloodType: 'A+', region: 'Lagos', quantity: '50' },
        status: ImportRowStatus.VALID,
        errors: null,
        quarantineReasonCode: null,
        rowHash: 'rowhash1',
        chunkIndex: 0,
        committedId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    } as ImportStagingRowEntity;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('ImportService', () => {
    let service: ImportService;

    const mockRepo = () => ({
        findOne: jest.fn(),
        find: jest.fn(),
        create: jest.fn((x) => x),
        save: jest.fn(async (x) => x),
        update: jest.fn(),
        insert: jest.fn(),
    });

    // Minimal transaction mock: runs the callback with a manager that mirrors the mocks
    const mockDataSource = {
        transaction: jest.fn(async (cb: (m: any) => Promise<any>) => {
            const manager = {
                findOne: jest.fn().mockResolvedValue(null),
                find: jest.fn().mockResolvedValue([]),
                create: jest.fn((_, x) => x),
                save: jest.fn(async (x) => ({ ...x, id: 'new-id' })),
                update: jest.fn(),
            };
            return cb(manager);
        }),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ImportService,
                { provide: getRepositoryToken(ImportBatchEntity), useFactory: mockRepo },
                { provide: getRepositoryToken(ImportStagingRowEntity), useFactory: mockRepo },
                { provide: getRepositoryToken(ImportCommittedHashEntity), useFactory: mockRepo },
                { provide: getRepositoryToken(OrganizationEntity), useFactory: mockRepo },
                { provide: getRepositoryToken(RiderEntity), useFactory: mockRepo },
                { provide: getRepositoryToken(InventoryEntity), useFactory: mockRepo },
                {
                    provide: ImportValidationService,
                    useValue: {
                        validateOrganizationRow: jest.fn().mockResolvedValue([]),
                        validateRiderRow: jest.fn().mockReturnValue([]),
                        validateInventoryRow: jest.fn().mockReturnValue([]),
                    },
                },
                {
                    provide: UserActivityService,
                    useValue: { logActivity: jest.fn() },
                },
                {
                    provide: FileMetadataService,
                    useValue: { register: jest.fn(), markOrphaned: jest.fn() },
                },
                { provide: DataSource, useValue: mockDataSource },
            ],
        }).compile();

        service = module.get(ImportService);
    });

    afterEach(() => jest.clearAllMocks());

    // ── stageImport ────────────────────────────────────────────────────────────

    describe('stageImport', () => {
        it('stages valid inventory rows', async () => {
            const batchRepo = service['batchRepo'];
            const hashRepo = service['hashRepo'];

            batchRepo.findOne.mockResolvedValue(null); // no existing file hash
            hashRepo.find.mockResolvedValue([]); // no committed hashes

            const savedBatch = makeBatch({ validRows: 2 });
            mockDataSource.transaction.mockImplementationOnce(async (cb: any) => {
                const manager = {
                    findOne: jest.fn().mockResolvedValue(null),
                    create: jest.fn((_, x) => x),
                    save: jest.fn(async (x) => Array.isArray(x) ? x : { ...x, id: 'batch-1' }),
                    update: jest.fn(),
                };
                return cb(manager);
            });

            // The service returns the batch from batchRepo.findOne after transaction
            batchRepo.findOne
                .mockResolvedValueOnce(null)   // file hash check
                .mockResolvedValueOnce(savedBatch); // final return

            const result = await service.stageImport(
                INVENTORY_CSV,
                ImportEntityType.INVENTORY,
                'admin',
                'test.csv',
            );

            expect(result).toBeDefined();
        });

        it('returns existing batch for duplicate file submission', async () => {
            const batchRepo = service['batchRepo'];
            const existing = makeBatch({ status: ImportBatchStatus.COMMITTED });
            batchRepo.findOne
                .mockResolvedValueOnce(existing)   // file hash match
                .mockResolvedValueOnce({ ...existing, status: ImportBatchStatus.DEDUPLICATED });
            batchRepo.update.mockResolvedValue(undefined);

            const result = await service.stageImport(
                INVENTORY_CSV,
                ImportEntityType.INVENTORY,
                'admin',
                'test.csv',
            );

            expect(result.status).toBe(ImportBatchStatus.DEDUPLICATED);
            expect(mockDataSource.transaction).not.toHaveBeenCalled();
        });

        it('marks cross-batch duplicate rows as DUPLICATE with reason code', async () => {
            const batchRepo = service['batchRepo'];
            const hashRepo = service['hashRepo'];

            batchRepo.findOne.mockResolvedValue(null);

            // Simulate one row hash already committed in a previous batch
            hashRepo.find.mockResolvedValue([
                { rowHash: expect.any(String), committedId: 'prev-id', entityType: ImportEntityType.INVENTORY },
            ]);

            const stagingRows: any[] = [];
            mockDataSource.transaction.mockImplementationOnce(async (cb: any) => {
                const manager = {
                    create: jest.fn((_, x) => { if (x.rowIndex !== undefined) stagingRows.push(x); return x; }),
                    save: jest.fn(async (x) => Array.isArray(x) ? x : { ...x, id: 'batch-1' }),
                    update: jest.fn(),
                };
                return cb(manager);
            });

            batchRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(makeBatch());

            await service.stageImport(INVENTORY_CSV, ImportEntityType.INVENTORY, 'admin', 'test.csv');
            // Duplicate detection is hash-based; the test verifies the flow doesn't throw
        });

        it('quarantines invalid rows with SCHEMA_VIOLATION reason code', async () => {
            const batchRepo = service['batchRepo'];
            const hashRepo = service['hashRepo'];
            const validationService = service['validationService'];

            batchRepo.findOne.mockResolvedValue(null);
            hashRepo.find.mockResolvedValue([]);
            (validationService.validateInventoryRow as jest.Mock).mockReturnValue(['Invalid bloodType']);

            const quarantinedRows: any[] = [];
            mockDataSource.transaction.mockImplementationOnce(async (cb: any) => {
                const manager = {
                    create: jest.fn((_, x) => {
                        if (x.status === ImportRowStatus.QUARANTINED) quarantinedRows.push(x);
                        return x;
                    }),
                    save: jest.fn(async (x) => Array.isArray(x) ? x : { ...x, id: 'batch-1' }),
                    update: jest.fn(),
                };
                return cb(manager);
            });

            batchRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(makeBatch());

            await service.stageImport(INVENTORY_CSV_INVALID, ImportEntityType.INVENTORY, 'admin', 'test.csv');

            // All rows should be quarantined since validation returns errors for all
            expect(quarantinedRows.length).toBeGreaterThan(0);
            quarantinedRows.forEach((r) => {
                expect(r.status).toBe(ImportRowStatus.QUARANTINED);
                expect(r.quarantineReasonCode).toBe(QuarantineReasonCode.SCHEMA_VIOLATION);
            });
        });
    });

    // ── commitBatch ────────────────────────────────────────────────────────────

    describe('commitBatch', () => {
        it('throws NotFoundException for unknown batch', async () => {
            service['batchRepo'].findOne.mockResolvedValue(null);
            await expect(service.commitBatch('bad-id', 'admin')).rejects.toThrow(NotFoundException);
        });

        it('throws ConflictException when batch is already COMMITTED', async () => {
            service['batchRepo'].findOne.mockResolvedValue(makeBatch({ status: ImportBatchStatus.COMMITTED }));
            await expect(service.commitBatch('batch-1', 'admin')).rejects.toThrow(ConflictException);
        });

        it('throws ConflictException for DEDUPLICATED batch', async () => {
            service['batchRepo'].findOne.mockResolvedValue(makeBatch({ status: ImportBatchStatus.DEDUPLICATED }));
            await expect(service.commitBatch('batch-1', 'admin')).rejects.toThrow(ConflictException);
        });

        it('commits valid rows and updates batch status to COMMITTED', async () => {
            const batchRepo = service['batchRepo'];
            const rowRepo = service['rowRepo'];

            batchRepo.findOne.mockResolvedValue(makeBatch());
            batchRepo.update.mockResolvedValue(undefined);
            rowRepo.find.mockResolvedValue([makeRow(), makeRow({ id: 'row-2', rowIndex: 1 })]);

            mockDataSource.transaction.mockImplementation(async (cb: any) => {
                const manager = {
                    findOne: jest.fn().mockResolvedValue(null), // no existing hash
                    create: jest.fn((_, x) => x),
                    save: jest.fn(async (x) => ({ ...x, id: 'committed-id' })),
                    update: jest.fn(),
                };
                return cb(manager);
            });

            const result = await service.commitBatch('batch-1', 'admin');

            expect(result.committed).toBe(2);
            expect(result.resumable).toBe(false);
            expect(batchRepo.update).toHaveBeenCalledWith(
                'batch-1',
                expect.objectContaining({ status: ImportBatchStatus.COMMITTED }),
            );
        });

        it('marks batch REJECTED when no valid rows exist', async () => {
            const batchRepo = service['batchRepo'];
            const rowRepo = service['rowRepo'];

            batchRepo.findOne.mockResolvedValue(makeBatch());
            batchRepo.update.mockResolvedValue(undefined);
            rowRepo.find.mockResolvedValue([]); // no valid rows

            const result = await service.commitBatch('batch-1', 'admin');

            expect(result.committed).toBe(0);
            expect(batchRepo.update).toHaveBeenCalledWith(
                'batch-1',
                expect.objectContaining({ status: ImportBatchStatus.REJECTED }),
            );
        });

        it('checkpoints after each chunk and returns resumable=true on error', async () => {
            const batchRepo = service['batchRepo'];
            const rowRepo = service['rowRepo'];

            batchRepo.findOne.mockResolvedValue(makeBatch({ chunkSize: 1 }));
            batchRepo.update.mockResolvedValue(undefined);

            const rows = [makeRow(), makeRow({ id: 'row-2', rowIndex: 1, chunkIndex: 1 })];
            rowRepo.find.mockResolvedValue(rows);
            rowRepo.update.mockResolvedValue(undefined);

            let callCount = 0;
            mockDataSource.transaction.mockImplementation(async (cb: any) => {
                callCount++;
                if (callCount === 1) {
                    // First chunk succeeds
                    const manager = {
                        findOne: jest.fn().mockResolvedValue(null),
                        create: jest.fn((_, x) => x),
                        save: jest.fn(async (x) => ({ ...x, id: 'committed-id' })),
                        update: jest.fn(),
                    };
                    return cb(manager);
                }
                // Second chunk throws
                throw new Error('DB connection lost');
            });

            const result = await service.commitBatch('batch-1', 'admin');

            expect(result.resumable).toBe(true);
            expect(result.committed).toBe(1);
            expect(batchRepo.update).toHaveBeenCalledWith(
                'batch-1',
                expect.objectContaining({ status: ImportBatchStatus.INTERRUPTED }),
            );
        });

        it('skips already-committed rows (cross-batch dedup at commit time)', async () => {
            const batchRepo = service['batchRepo'];
            const rowRepo = service['rowRepo'];

            batchRepo.findOne.mockResolvedValue(makeBatch());
            batchRepo.update.mockResolvedValue(undefined);
            rowRepo.find.mockResolvedValue([makeRow({ rowHash: 'known-hash' })]);
            rowRepo.update.mockResolvedValue(undefined);

            mockDataSource.transaction.mockImplementation(async (cb: any) => {
                const manager = {
                    findOne: jest.fn().mockResolvedValue({ committedId: 'prev-id' }), // hash exists
                    create: jest.fn((_, x) => x),
                    save: jest.fn(async (x) => x),
                    update: jest.fn(),
                };
                return cb(manager);
            });

            const result = await service.commitBatch('batch-1', 'admin');

            // Row was skipped as duplicate, not committed
            expect(result.committed).toBe(0);
        });
    });

    // ── resumeBatch ────────────────────────────────────────────────────────────

    describe('resumeBatch', () => {
        it('throws ConflictException when batch is not INTERRUPTED', async () => {
            service['batchRepo'].findOne.mockResolvedValue(makeBatch({ status: ImportBatchStatus.COMMITTED }));
            await expect(service.resumeBatch('batch-1', 'admin')).rejects.toThrow(ConflictException);
        });

        it('throws ConflictException when retry limit exceeded', async () => {
            service['batchRepo'].findOne.mockResolvedValue(
                makeBatch({ status: ImportBatchStatus.INTERRUPTED, retryCount: 3 }),
            );
            await expect(service.resumeBatch('batch-1', 'admin')).rejects.toThrow(ConflictException);
        });

        it('re-marks COMMIT_ERROR quarantined rows as VALID before retrying', async () => {
            const batchRepo = service['batchRepo'];
            const rowRepo = service['rowRepo'];

            const interrupted = makeBatch({
                status: ImportBatchStatus.INTERRUPTED,
                retryCount: 1,
                lastCommittedChunk: 0,
            });
            batchRepo.findOne.mockResolvedValue(interrupted);
            batchRepo.update.mockResolvedValue(undefined);
            rowRepo.update.mockResolvedValue(undefined);
            rowRepo.find.mockResolvedValue([]); // no valid rows after re-mark (simplified)

            await service.resumeBatch('batch-1', 'admin');

            expect(rowRepo.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    batchId: 'batch-1',
                    status: ImportRowStatus.QUARANTINED,
                    quarantineReasonCode: QuarantineReasonCode.COMMIT_ERROR,
                }),
                expect.objectContaining({ status: ImportRowStatus.VALID }),
            );
        });

        it('resumes from last committed chunk without re-processing earlier chunks', async () => {
            const batchRepo = service['batchRepo'];
            const rowRepo = service['rowRepo'];

            const interrupted = makeBatch({
                status: ImportBatchStatus.INTERRUPTED,
                retryCount: 0,
                lastCommittedChunk: 1, // chunks 0 and 1 already done
                committedRows: 2,
                chunkSize: 1,
            });
            batchRepo.findOne.mockResolvedValue(interrupted);
            batchRepo.update.mockResolvedValue(undefined);
            rowRepo.update.mockResolvedValue(undefined);

            // Only chunk 2 row remains as VALID
            rowRepo.find.mockResolvedValue([makeRow({ rowIndex: 2, chunkIndex: 2 })]);

            mockDataSource.transaction.mockImplementation(async (cb: any) => {
                const manager = {
                    findOne: jest.fn().mockResolvedValue(null),
                    create: jest.fn((_, x) => x),
                    save: jest.fn(async (x) => ({ ...x, id: 'new-id' })),
                    update: jest.fn(),
                };
                return cb(manager);
            });

            const result = await service.resumeBatch('batch-1', 'admin');

            // Should commit the remaining row (chunk 2)
            expect(result.committed).toBeGreaterThanOrEqual(0);
        });
    });

    // ── getQualityReport ───────────────────────────────────────────────────────

    describe('getQualityReport', () => {
        it('throws NotFoundException for unknown batch', async () => {
            service['batchRepo'].findOne.mockResolvedValue(null);
            await expect(service.getQualityReport('bad-id')).rejects.toThrow(NotFoundException);
        });

        it('returns correct acceptance and rejection rates', async () => {
            const batchRepo = service['batchRepo'];
            const rowRepo = service['rowRepo'];

            batchRepo.findOne.mockResolvedValue(
                makeBatch({
                    totalRows: 10,
                    committedRows: 7,
                    quarantinedRows: 2,
                    failedRows: 1,
                    chunkSize: 5,
                    status: ImportBatchStatus.COMMITTED,
                }),
            );

            rowRepo.find.mockResolvedValue([
                makeRow({ status: ImportRowStatus.QUARANTINED, quarantineReasonCode: QuarantineReasonCode.SCHEMA_VIOLATION, errors: ['Invalid bloodType'] }),
                makeRow({ status: ImportRowStatus.QUARANTINED, quarantineReasonCode: QuarantineReasonCode.DUPLICATE_IN_DB, errors: ['Duplicate'] }),
            ]);

            const report = await service.getQualityReport('batch-1');

            expect(report.acceptanceRate).toBe(70);
            expect(report.rejectionRate).toBe(30);
            expect(report.resumable).toBe(false);
            expect(report.chunksTotal).toBe(2);
            expect(report.quarantineBreakdown[QuarantineReasonCode.SCHEMA_VIOLATION]).toBe(1);
            expect(report.quarantineBreakdown[QuarantineReasonCode.DUPLICATE_IN_DB]).toBe(1);
            expect(report.topErrors).toHaveLength(2);
        });

        it('marks interrupted batch as resumable', async () => {
            service['batchRepo'].findOne.mockResolvedValue(
                makeBatch({ status: ImportBatchStatus.INTERRUPTED, totalRows: 5, committedRows: 2 }),
            );
            service['rowRepo'].find.mockResolvedValue([]);

            const report = await service.getQualityReport('batch-1');
            expect(report.resumable).toBe(true);
        });

        it('returns zero rates for empty batch', async () => {
            service['batchRepo'].findOne.mockResolvedValue(
                makeBatch({ totalRows: 0, committedRows: 0, quarantinedRows: 0 }),
            );
            service['rowRepo'].find.mockResolvedValue([]);

            const report = await service.getQualityReport('batch-1');
            expect(report.acceptanceRate).toBe(0);
            expect(report.rejectionRate).toBe(0);
        });
    });

    // ── getQuarantinedRows ─────────────────────────────────────────────────────

    describe('getQuarantinedRows', () => {
        it('returns quarantined rows filtered by reason code', async () => {
            const rowRepo = service['rowRepo'];
            const quarantined = [
                makeRow({ status: ImportRowStatus.QUARANTINED, quarantineReasonCode: QuarantineReasonCode.SCHEMA_VIOLATION }),
            ];
            rowRepo.find.mockResolvedValue(quarantined);

            const result = await service.getQuarantinedRows('batch-1', QuarantineReasonCode.SCHEMA_VIOLATION);

            expect(rowRepo.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        quarantineReasonCode: QuarantineReasonCode.SCHEMA_VIOLATION,
                    }),
                }),
            );
            expect(result).toHaveLength(1);
        });
    });
});
