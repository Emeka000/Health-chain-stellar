import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { TemperatureSampleEntity } from './entities/temperature-sample.entity';
import { IngestTelemetryDto } from './dto/ingest-telemetry.dto';

export interface TelemetryRecord extends IngestTelemetryDto {
  sequenceNumber?: number;
  sensorId?: string;
  humidity?: number;
}

export interface PipelineResult {
  accepted: boolean;
  sampleId?: string;
  stage: 'validation' | 'normalization' | 'enrichment' | 'dedup' | 'persistence';
  reason?: string;
  qualityScore: number;
}

export interface BackpressureStatus {
  queueDepth: number;
  maxDepth: number;
  shedding: boolean;
}

/** Sensor quality thresholds */
const QUALITY_REJECT_THRESHOLD = 0.3;
const QUALITY_QUARANTINE_THRESHOLD = 0.5;
const TEMP_PLAUSIBLE_MIN = -100;
const TEMP_PLAUSIBLE_MAX = 100;
const DEDUP_WINDOW_MS = 5_000;
const MAX_QUEUE_DEPTH = 1_000;

@Injectable()
export class TelemetryIngestionPipelineService {
  private readonly logger = new Logger(TelemetryIngestionPipelineService.name);

  /** In-memory bounded queue for backpressure */
  private readonly queue: TelemetryRecord[] = [];
  /** Dedup fingerprint cache: fingerprint -> timestamp */
  private readonly dedupCache = new Map<string, number>();
  /** Last sequence number per deliveryId for gap detection */
  private readonly lastSequence = new Map<string, number>();

  constructor(
    @InjectRepository(TemperatureSampleEntity)
    private readonly sampleRepo: Repository<TemperatureSampleEntity>,
  ) {}

  /**
   * Main ingestion entry point. Runs the full pipeline:
   * validation → normalization → enrichment → dedup → persistence.
   */
  async ingest(record: TelemetryRecord): Promise<PipelineResult> {
    // Backpressure: shed load when queue is full
    if (this.queue.length >= MAX_QUEUE_DEPTH) {
      this.logger.warn(`Backpressure: queue full (${this.queue.length}), shedding record for delivery=${record.deliveryId}`);
      return { accepted: false, stage: 'validation', reason: 'backpressure', qualityScore: 0 };
    }

    // Stage 1: Validation
    const validationResult = this.validate(record);
    if (!validationResult.valid) {
      return { accepted: false, stage: 'validation', reason: validationResult.reason, qualityScore: 0 };
    }

    // Stage 2: Normalization
    const normalized = this.normalize(record);

    // Stage 3: Quality scoring
    const qualityScore = this.scoreQuality(normalized);
    if (qualityScore <= QUALITY_REJECT_THRESHOLD) {
      this.logger.warn(`Rejected low-quality sample: delivery=${record.deliveryId} score=${qualityScore}`);
      return { accepted: false, stage: 'normalization', reason: 'quality_too_low', qualityScore };
    }

    // Stage 4: Deduplication
    const fingerprint = this.fingerprint(normalized);
    const lastSeen = this.dedupCache.get(fingerprint);
    if (lastSeen && Date.now() - lastSeen < DEDUP_WINDOW_MS) {
      return { accepted: false, stage: 'dedup', reason: 'duplicate', qualityScore };
    }
    this.dedupCache.set(fingerprint, Date.now());

    // Sequence gap detection
    this.detectSequenceGap(normalized);

    // Stage 5: Enrichment + Persistence
    const enriched = this.enrich(normalized, qualityScore);
    const saved = await this.persist(enriched);

    return { accepted: true, sampleId: saved.id, stage: 'persistence', qualityScore };
  }

  /** Batch ingestion with per-record results */
  async ingestBatch(records: TelemetryRecord[]): Promise<PipelineResult[]> {
    return Promise.all(records.map((r) => this.ingest(r)));
  }

  getBackpressureStatus(): BackpressureStatus {
    return {
      queueDepth: this.queue.length,
      maxDepth: MAX_QUEUE_DEPTH,
      shedding: this.queue.length >= MAX_QUEUE_DEPTH,
    };
  }

  // ── Private pipeline stages ──────────────────────────────────────────────

  private validate(record: TelemetryRecord): { valid: boolean; reason?: string } {
    if (!record.deliveryId) return { valid: false, reason: 'missing deliveryId' };
    if (typeof record.temperatureCelsius !== 'number' || isNaN(record.temperatureCelsius)) {
      return { valid: false, reason: 'invalid temperature' };
    }
    if (record.temperatureCelsius < TEMP_PLAUSIBLE_MIN || record.temperatureCelsius > TEMP_PLAUSIBLE_MAX) {
      return { valid: false, reason: 'temperature out of plausible range' };
    }
    return { valid: true };
  }

  private normalize(record: TelemetryRecord): TelemetryRecord {
    return {
      ...record,
      temperatureCelsius: Math.round(record.temperatureCelsius * 100) / 100,
      recordedAt: record.recordedAt ?? new Date().toISOString(),
      source: record.source ?? 'iot',
    };
  }

  /**
   * Quality score 0–1 based on:
   * - Source reliability (iot=1.0, rider=0.8, manual=0.6)
   * - Plausibility of temperature value
   * - Presence of optional fields
   */
  private scoreQuality(record: TelemetryRecord): number {
    let score = 1.0;

    const sourceScores: Record<string, number> = { iot: 1.0, rider: 0.8, manual: 0.6 };
    score *= sourceScores[record.source ?? 'manual'] ?? 0.5;

    // Penalise extreme but technically valid readings
    const temp = record.temperatureCelsius;
    if (temp < -50 || temp > 80) score *= 0.5;

    // Bonus for optional enrichment fields
    if (record.sensorId) score = Math.min(1.0, score + 0.05);
    if (record.humidity !== undefined) score = Math.min(1.0, score + 0.05);

    return Math.round(score * 100) / 100;
  }

  private fingerprint(record: TelemetryRecord): string {
    const key = `${record.deliveryId}:${record.temperatureCelsius}:${record.recordedAt}`;
    return createHash('md5').update(key).digest('hex');
  }

  private detectSequenceGap(record: TelemetryRecord): void {
    if (record.sequenceNumber === undefined) return;
    const last = this.lastSequence.get(record.deliveryId);
    if (last !== undefined && record.sequenceNumber !== last + 1) {
      this.logger.warn(
        `Sequence gap detected: delivery=${record.deliveryId} expected=${last + 1} got=${record.sequenceNumber}`,
      );
    }
    this.lastSequence.set(record.deliveryId, record.sequenceNumber);
  }

  private enrich(record: TelemetryRecord, qualityScore: number): TelemetryRecord & { qualityScore: number } {
    return { ...record, qualityScore };
  }

  private async persist(
    record: TelemetryRecord & { qualityScore: number },
  ): Promise<TemperatureSampleEntity> {
    const isExcursion = record.temperatureCelsius < 2 || record.temperatureCelsius > 8;
    const sample = this.sampleRepo.create({
      deliveryId: record.deliveryId,
      orderId: record.orderId ?? null,
      temperatureCelsius: record.temperatureCelsius,
      recordedAt: record.recordedAt ? new Date(record.recordedAt) : new Date(),
      source: record.source ?? 'iot',
      isExcursion,
    });
    return this.sampleRepo.save(sample);
  }
}
