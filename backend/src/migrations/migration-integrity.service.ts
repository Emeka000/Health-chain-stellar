import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';

export interface MigrationRecord {
  id: number;
  timestamp: string;
  name: string;
}

export interface IntegrityReport {
  totalMigrations: number;
  pendingMigrations: string[];
  duplicateTimestamps: string[];
  outOfOrderMigrations: string[];
  integrityHash: string;
  generatedAt: Date;
}

/**
 * Verifies migration state integrity: detects duplicates, ordering gaps,
 * and pending unapplied migrations.
 */
@Injectable()
export class MigrationIntegrityService {
  private readonly logger = new Logger(MigrationIntegrityService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async generateReport(): Promise<IntegrityReport> {
    const applied = await this.getAppliedMigrations();
    const registered = this.getRegisteredMigrations();

    const appliedNames = new Set(applied.map((m) => m.name));
    const pendingMigrations = registered.filter((name) => !appliedNames.has(name));

    const duplicateTimestamps = this.findDuplicateTimestamps(applied);
    const outOfOrderMigrations = this.findOutOfOrderMigrations(applied);

    const integrityHash = this.computeIntegrityHash(applied);

    const report: IntegrityReport = {
      totalMigrations: applied.length,
      pendingMigrations,
      duplicateTimestamps,
      outOfOrderMigrations,
      integrityHash,
      generatedAt: new Date(),
    };

    this.logger.log(
      `Integrity report: ${applied.length} applied, ${pendingMigrations.length} pending, ` +
        `${duplicateTimestamps.length} duplicates, ${outOfOrderMigrations.length} out-of-order`,
    );

    return report;
  }

  private async getAppliedMigrations(): Promise<MigrationRecord[]> {
    try {
      const rows = await this.dataSource.query<MigrationRecord[]>(
        `SELECT id, timestamp, name FROM migrations ORDER BY timestamp ASC`,
      );
      return rows;
    } catch {
      // migrations table may not exist yet
      return [];
    }
  }

  /** Returns migration class names registered in the DataSource. */
  private getRegisteredMigrations(): string[] {
    const migrations = this.dataSource.options.migrations ?? [];
    return migrations.map((m) => {
      if (typeof m === 'function') return m.name;
      return String(m);
    });
  }

  private findDuplicateTimestamps(migrations: MigrationRecord[]): string[] {
    const seen = new Map<string, string[]>();
    for (const m of migrations) {
      const ts = m.timestamp;
      if (!seen.has(ts)) seen.set(ts, []);
      seen.get(ts)!.push(m.name);
    }
    const duplicates: string[] = [];
    for (const [ts, names] of seen) {
      if (names.length > 1) duplicates.push(`${ts}: ${names.join(', ')}`);
    }
    return duplicates;
  }

  private findOutOfOrderMigrations(migrations: MigrationRecord[]): string[] {
    const outOfOrder: string[] = [];
    for (let i = 1; i < migrations.length; i++) {
      if (BigInt(migrations[i].timestamp) < BigInt(migrations[i - 1].timestamp)) {
        outOfOrder.push(migrations[i].name);
      }
    }
    return outOfOrder;
  }

  private computeIntegrityHash(migrations: MigrationRecord[]): string {
    const payload = migrations.map((m) => `${m.timestamp}:${m.name}`).join('|');
    return createHash('sha256').update(payload).digest('hex');
  }
}
