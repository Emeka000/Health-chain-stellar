import {
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { BloodComponent } from '../enums/blood-component.enum';
import { BloodStatus } from '../enums/blood-status.enum';
import { BloodType } from '../enums/blood-type.enum';
import { BloodUnit } from '../entities/blood-unit.entity';

const BATCH_LIMIT = 500;

const VALID_BLOOD_TYPES = new Set<string>(Object.values(BloodType));
const VALID_COMPONENTS = new Set<string>(Object.values(BloodComponent));

export interface BatchRowResult {
  row: number;
  status: 'created' | 'skipped' | 'error';
  reason?: string;
}

interface ParsedRow {
  bloodType: BloodType;
  component: BloodComponent;
  volumeMl: number;
  expiresAt: Date;
  organizationId: string;
  donorId?: string;
  collectedAt: Date;
}

@Injectable()
export class BloodUnitBatchService {
  constructor(
    @InjectRepository(BloodUnit)
    private readonly bloodUnitRepo: Repository<BloodUnit>,
    private readonly dataSource: DataSource,
  ) {}

  async importFromCsv(
    csvBuffer: Uint8Array,
    organizationId: string,
  ): Promise<{ results: BatchRowResult[]; created: number; errors: number }> {
    const lines = new TextDecoder()
      .decode(csvBuffer)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      throw new UnprocessableEntityException('CSV must contain a header row and at least one data row');
    }

    const [headerLine, ...dataLines] = lines;
    const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());

    // Reject before any processing if over the limit
    if (dataLines.length > BATCH_LIMIT) {
      throw new UnprocessableEntityException(
        `Batch size ${dataLines.length} exceeds the maximum of ${BATCH_LIMIT} rows`,
      );
    }

    const results: BatchRowResult[] = [];
    const validUnits: Partial<BloodUnit>[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const rowNumber = i + 2; // 1-based, accounting for header
      const raw = this.parseCsvLine(dataLines[i], headers);
      const validation = this.validateRow(raw);

      if (validation.error) {
        results.push({ row: rowNumber, status: 'error', reason: validation.error });
        continue;
      }

      const parsed = validation.data!;
      validUnits.push({
        bloodType: parsed.bloodType,
        component: parsed.component,
        volumeMl: parsed.volumeMl,
        expiresAt: parsed.expiresAt,
        collectedAt: parsed.collectedAt,
        organizationId: parsed.organizationId ?? organizationId,
        donorId: parsed.donorId ?? null,
        status: BloodStatus.AVAILABLE,
        unitCode: this.generateUnitCode(parsed.bloodType, rowNumber),
        testResults: null,
        storageTemperatureCelsius: null,
        storageLocation: null,
        blockchainUnitId: null,
        blockchainTxHash: null,
        reservedFor: null,
        reservedUntil: null,
        latitude: null,
        longitude: null,
        location: null,
      });
      results.push({ row: rowNumber, status: 'created' });
    }

    // Persist all valid units in a single transaction
    if (validUnits.length > 0) {
      await this.dataSource.transaction(async (manager) => {
        const entities = validUnits.map((u) => manager.create(BloodUnit, u));
        await manager.save(BloodUnit, entities);
      });
    }

    const created = results.filter((r) => r.status === 'created').length;
    const errors = results.filter((r) => r.status === 'error').length;

    return { results, created, errors };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private parseCsvLine(
    line: string,
    headers: string[],
  ): Record<string, string> {
    const values = line.split(',').map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    return row;
  }

  private validateRow(raw: Record<string, string>): {
    error?: string;
    data?: ParsedRow;
  } {
    const bloodType = raw['blood_type'] ?? raw['bloodtype'] ?? raw['blood type'] ?? '';
    if (!VALID_BLOOD_TYPES.has(bloodType)) {
      return { error: `Invalid blood_type "${bloodType}". Must be one of: ${[...VALID_BLOOD_TYPES].join(', ')}` };
    }

    const component = (raw['component'] ?? '').toUpperCase();
    if (!VALID_COMPONENTS.has(component)) {
      return { error: `Invalid component "${raw['component']}". Must be one of: ${[...VALID_COMPONENTS].join(', ')}` };
    }

    const volumeMl = Number(raw['volume_ml'] ?? raw['volumeml'] ?? raw['volume']);
    if (!Number.isInteger(volumeMl) || volumeMl < 50 || volumeMl > 500) {
      return { error: `volume_ml must be an integer between 50 and 500, got "${raw['volume_ml'] ?? raw['volume']}"` };
    }

    const expiryRaw = raw['expires_at'] ?? raw['expiry_date'] ?? raw['expiry'] ?? '';
    const expiresAt = new Date(expiryRaw);
    if (isNaN(expiresAt.getTime())) {
      return { error: `Invalid expires_at date "${expiryRaw}"` };
    }
    if (expiresAt <= new Date()) {
      return { error: `expires_at must be a future date, got "${expiryRaw}"` };
    }

    const collectedRaw = raw['collected_at'] ?? raw['collection_date'] ?? '';
    const collectedAt = collectedRaw ? new Date(collectedRaw) : new Date();
    if (isNaN(collectedAt.getTime())) {
      return { error: `Invalid collected_at date "${collectedRaw}"` };
    }

    return {
      data: {
        bloodType: bloodType as BloodType,
        component: component as BloodComponent,
        volumeMl,
        expiresAt,
        collectedAt,
        organizationId: (raw['organization_id'] ?? raw['org_id'] ?? '').trim() || '',
        donorId: (raw['donor_id'] ?? '').trim() || undefined,
      },
    };
  }

  private generateUnitCode(bloodType: BloodType, rowIndex: number): string {
    const ts = Date.now().toString(36).toUpperCase();
    const bt = bloodType.replace('+', 'P').replace('-', 'N');
    return `BU-${bt}-${ts}-${String(rowIndex).padStart(4, '0')}`;
  }
}
