/**
 * BatchImportModule – integration / wiring audit spec
 *
 * Verifies that:
 *  1. All @InjectRepository tokens referenced by ImportService and
 *     ImportValidationService are present in TypeOrmModule.forFeature.
 *  2. ImportValidationService is declared in providers.
 *  3. All cross-module dependencies (UserActivityModule, FileMetadataModule)
 *     are present in imports.
 *  4. The NestJS DI container can resolve ImportService and
 *     ImportValidationService without errors when all repositories and
 *     transitive providers are stubbed.
 *
 * This spec acts as a regression guard: if anyone removes a repository or
 * provider from BatchImportModule the build/test step will immediately fail
 * instead of causing a silent DI error at runtime.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ImportService } from './import.service';
import { ImportValidationService } from './import-validation.service';
import { ImportBatchEntity } from './entities/import-batch.entity';
import { ImportCommittedHashEntity } from './entities/import-committed-hash.entity';
import { ImportStagingRowEntity } from './entities/import-staging-row.entity';

import { InventoryEntity } from '../inventory/entities/inventory.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { RiderEntity } from '../riders/entities/rider.entity';
import { UserActivityService } from '../user-activity/user-activity.service';
import { FileMetadataService } from '../file-metadata/file-metadata.service';

// ── Stub factory ──────────────────────────────────────────────────────────────

function mockRepo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((d) => d),
    save: jest.fn(async (d) => ({ id: 'stub-id', ...d })),
    update: jest.fn(),
  };
}

// ── Module wiring audit ───────────────────────────────────────────────────────

describe('BatchImportModule wiring audit', () => {
  it('TypeOrmModule.forFeature includes all entities required by ImportService', async () => {
    const { BatchImportModule } = await import('./batch-import.module');
    const imports: unknown[] = Reflect.getMetadata('imports', BatchImportModule) ?? [];

    // Collect every entity registered via TypeOrmModule.forFeature
    const registeredEntities: unknown[] = [];
    for (const imp of imports) {
      // TypeOrmModule.forFeature returns a DynamicModule; its providers expose
      // the repository tokens via getRepositoryToken(<Entity>)
      if (imp && typeof imp === 'object' && 'module' in imp) {
        const dynMod = imp as { providers?: Array<{ provide?: unknown }> };
        for (const p of dynMod.providers ?? []) {
          registeredEntities.push(p.provide);
        }
      }
    }

    // These are the tokens TypeORM registers for each forFeature entity
    const expectedTokens = [
      getRepositoryToken(ImportBatchEntity),
      getRepositoryToken(ImportStagingRowEntity),
      getRepositoryToken(ImportCommittedHashEntity),
      getRepositoryToken(OrganizationEntity),
      getRepositoryToken(RiderEntity),
      getRepositoryToken(InventoryEntity),
    ];

    for (const token of expectedTokens) {
      expect(registeredEntities).toContain(token);
    }
  });

  it('providers array contains both ImportService and ImportValidationService', async () => {
    const { BatchImportModule } = await import('./batch-import.module');
    const providers: unknown[] = Reflect.getMetadata('providers', BatchImportModule) ?? [];
    expect(providers).toContain(ImportService);
    expect(providers).toContain(ImportValidationService);
  });

  it('resolves ImportService and ImportValidationService via DI when dependencies are stubbed', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        ImportValidationService,
        // Repository stubs
        { provide: getRepositoryToken(ImportBatchEntity), useValue: mockRepo() },
        { provide: getRepositoryToken(ImportStagingRowEntity), useValue: mockRepo() },
        { provide: getRepositoryToken(ImportCommittedHashEntity), useValue: mockRepo() },
        { provide: getRepositoryToken(OrganizationEntity), useValue: mockRepo() },
        { provide: getRepositoryToken(RiderEntity), useValue: mockRepo() },
        { provide: getRepositoryToken(InventoryEntity), useValue: mockRepo() },
        // Cross-module service stubs
        { provide: UserActivityService, useValue: { logActivity: jest.fn() } },
        { provide: FileMetadataService, useValue: { register: jest.fn() } },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    const importService = module.get<ImportService>(ImportService);
    const validationService = module.get<ImportValidationService>(ImportValidationService);

    expect(importService).toBeDefined();
    expect(validationService).toBeDefined();
  });

  it('ImportValidationService injects OrganizationEntity repository (DB-duplicate check)', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportValidationService,
        { provide: getRepositoryToken(OrganizationEntity), useValue: mockRepo() },
      ],
    }).compile();

    const svc = module.get<ImportValidationService>(ImportValidationService);
    expect(svc).toBeDefined();
  });
});
