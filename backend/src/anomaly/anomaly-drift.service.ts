import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AnomalyIncidentEntity } from './entities/anomaly-incident.entity';
import { AnomalyType, AnomalySeverity, AnomalyStatus } from './enums/anomaly-type.enum';

/** Baseline feature distribution snapshot */
export interface FeatureBaseline {
  modelVersion: string;
  featureName: string;
  mean: number;
  stdDev: number;
  sampleSize: number;
  capturedAt: Date;
}

export interface DriftEvaluationResult {
  modelVersion: string;
  driftDetected: boolean;
  driftedFeatures: string[];
  maxDriftScore: number;
  incidentId: string | null;
}

/** Shadow/canary scoring comparison result */
export interface ShadowScoringResult {
  currentModelVersion: string;
  candidateModelVersion: string;
  agreementRate: number;
  divergentCases: number;
  totalCases: number;
  recommendation: 'promote' | 'hold' | 'rollback';
}

const CURRENT_MODEL_VERSION = '1.0.0';
const DRIFT_CONFIDENCE_THRESHOLD = 2.0; // z-score threshold (2 std devs)

@Injectable()
export class AnomalyDriftService {
  private readonly logger = new Logger(AnomalyDriftService.name);

  /**
   * In-memory baseline store. In production this would be persisted
   * to a dedicated table or a feature store.
   */
  private baselines = new Map<string, FeatureBaseline>();

  constructor(
    @InjectRepository(AnomalyIncidentEntity)
    private readonly anomalyRepo: Repository<AnomalyIncidentEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Run drift evaluation every 6 hours */
  @Cron(CronExpression.EVERY_6_HOURS)
  async runDriftEvaluation(): Promise<void> {
    this.logger.log('Running anomaly model drift evaluation');
    await this.evaluateDrift(CURRENT_MODEL_VERSION);
  }

  /**
   * Evaluate drift for a given model version against stored baselines.
   * Triggers an incident review workflow when drift exceeds threshold.
   */
  async evaluateDrift(modelVersion: string): Promise<DriftEvaluationResult> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

    // Compute current feature distribution from recent anomaly metadata
    const recentIncidents = await this.anomalyRepo.find({
      where: { createdAt: MoreThan(since) },
    });

    const currentDistribution = this.computeDistribution(recentIncidents);
    const driftedFeatures: string[] = [];
    let maxDriftScore = 0;

    for (const [feature, currentStats] of Object.entries(currentDistribution)) {
      const baseline = this.baselines.get(`${modelVersion}:${feature}`);
      if (!baseline) continue;

      const zScore = Math.abs((currentStats.mean - baseline.mean) / (baseline.stdDev || 1));
      if (zScore > maxDriftScore) maxDriftScore = zScore;

      if (zScore > DRIFT_CONFIDENCE_THRESHOLD) {
        driftedFeatures.push(feature);
        this.logger.warn(
          `Drift detected on feature "${feature}" for model ${modelVersion}: z-score=${zScore.toFixed(2)}`,
        );
      }
    }

    const driftDetected = driftedFeatures.length > 0;
    let incidentId: string | null = null;

    if (driftDetected) {
      const incident = await this.createDriftIncident(modelVersion, driftedFeatures, maxDriftScore);
      incidentId = incident.id;

      // Auto-trigger review workflow for severe drift
      if (maxDriftScore > DRIFT_CONFIDENCE_THRESHOLD * 2) {
        this.eventEmitter.emit('anomaly.drift.severe', {
          modelVersion,
          driftedFeatures,
          maxDriftScore,
          incidentId,
        });
        this.logger.error(`Severe drift detected — auto-triggering review workflow for model ${modelVersion}`);
      } else {
        this.eventEmitter.emit('anomaly.drift.detected', {
          modelVersion,
          driftedFeatures,
          maxDriftScore,
          incidentId,
        });
      }
    }

    return { modelVersion, driftDetected, driftedFeatures, maxDriftScore, incidentId };
  }

  /**
   * Register a baseline distribution snapshot for a model version and feature.
   */
  registerBaseline(baseline: FeatureBaseline): void {
    this.baselines.set(`${baseline.modelVersion}:${baseline.featureName}`, baseline);
    this.logger.log(`Baseline registered: model=${baseline.modelVersion} feature=${baseline.featureName}`);
  }

  /**
   * Shadow/canary comparison: compare current model decisions against a candidate.
   * Returns agreement rate and promotion recommendation.
   */
  async compareShadowScoring(
    currentScores: number[],
    candidateScores: number[],
    currentModelVersion: string,
    candidateModelVersion: string,
  ): Promise<ShadowScoringResult> {
    if (currentScores.length !== candidateScores.length || currentScores.length === 0) {
      return {
        currentModelVersion,
        candidateModelVersion,
        agreementRate: 0,
        divergentCases: 0,
        totalCases: 0,
        recommendation: 'hold',
      };
    }

    const threshold = 0.1; // 10% relative difference = divergent
    let divergentCases = 0;
    for (let i = 0; i < currentScores.length; i++) {
      const diff = Math.abs(currentScores[i] - candidateScores[i]);
      const relative = diff / (Math.abs(currentScores[i]) || 1);
      if (relative > threshold) divergentCases++;
    }

    const totalCases = currentScores.length;
    const agreementRate = (totalCases - divergentCases) / totalCases;

    let recommendation: 'promote' | 'hold' | 'rollback';
    if (agreementRate >= 0.95) recommendation = 'promote';
    else if (agreementRate >= 0.80) recommendation = 'hold';
    else recommendation = 'rollback';

    return { currentModelVersion, candidateModelVersion, agreementRate, divergentCases, totalCases, recommendation };
  }

  /** Get drift report for governance review */
  async getDriftReport(modelVersion?: string): Promise<{
    incidents: AnomalyIncidentEntity[];
    baselines: FeatureBaseline[];
  }> {
    const qb = this.anomalyRepo
      .createQueryBuilder('a')
      .where('a.type = :type', { type: AnomalyType.MODEL_DRIFT })
      .orderBy('a.created_at', 'DESC');

    if (modelVersion) {
      qb.andWhere('a.model_version = :modelVersion', { modelVersion });
    }

    const incidents = await qb.getMany();
    const baselines = Array.from(this.baselines.values()).filter(
      (b) => !modelVersion || b.modelVersion === modelVersion,
    );

    return { incidents, baselines };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private computeDistribution(incidents: AnomalyIncidentEntity[]): Record<string, { mean: number; stdDev: number }> {
    if (incidents.length === 0) return {};

    // Use severity as a numeric feature (LOW=1, MEDIUM=2, HIGH=3)
    const severityMap: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
    const scores = incidents.map((i) => severityMap[i.severity] ?? 2);

    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    return { severity_score: { mean, stdDev } };
  }

  private async createDriftIncident(
    modelVersion: string,
    driftedFeatures: string[],
    maxDriftScore: number,
  ): Promise<AnomalyIncidentEntity> {
    const severity = maxDriftScore > DRIFT_CONFIDENCE_THRESHOLD * 2
      ? AnomalySeverity.HIGH
      : AnomalySeverity.MEDIUM;

    const incident = this.anomalyRepo.create({
      type: AnomalyType.MODEL_DRIFT,
      severity,
      status: AnomalyStatus.OPEN,
      description: `Model drift detected for version ${modelVersion}. Drifted features: ${driftedFeatures.join(', ')}. Max z-score: ${maxDriftScore.toFixed(2)}.`,
      modelVersion,
      metadata: { driftedFeatures, maxDriftScore, detectedAt: new Date().toISOString() },
    });

    return this.anomalyRepo.save(incident);
  }
}
