import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';

import { PolicyVersionEntity } from './entities/policy-version.entity';
import { PolicyRolloutEntity } from './entities/policy-rollout.entity';
import { CanaryMetricEntity } from './entities/canary-metric.entity';
import { RolloutStatus } from './enums/rollout-status.enum';
import { PolicyVersionStatus } from './enums/policy-version-status.enum';
import { PolicyReplayService } from './policy-replay.service';

export interface StartRolloutDto {
  policyVersionId: string;
  canaryPercent?: number;
  stepPercent?: number;
  canaryWindowMinutes?: number;
  errorRateThreshold?: number;
}

export interface RolloutSummary {
  rolloutId: string;
  policyVersionId: string;
  status: RolloutStatus;
  currentPercent: number;
  canaryEvaluation: string | null;
  canaryMetrics: Record<string, any> | null;
}

@Injectable()
export class PolicyRolloutService {
  private readonly logger = new Logger(PolicyRolloutService.name);

  constructor(
    @InjectRepository(PolicyVersionEntity)
    private readonly policyRepo: Repository<PolicyVersionEntity>,
    @InjectRepository(PolicyRolloutEntity)
    private readonly rolloutRepo: Repository<PolicyRolloutEntity>,
    @InjectRepository(CanaryMetricEntity)
    private readonly metricsRepo: Repository<CanaryMetricEntity>,
    private readonly replayService: PolicyReplayService,
  ) {}

  /**
   * Begin a staged rollout for a DRAFT policy version.
   * Sets the version to canary traffic percentage and starts the evaluation window.
   */
  async startRollout(
    dto: StartRolloutDto,
    actor: string,
  ): Promise<PolicyRolloutEntity> {
    const version = await this.policyRepo.findOne({
      where: { id: dto.policyVersionId },
    });
    if (!version)
      throw new NotFoundException(
        `Policy version ${dto.policyVersionId} not found`,
      );

    if (version.status !== PolicyVersionStatus.DRAFT) {
      throw new BadRequestException(
        `Only DRAFT versions can be rolled out. Current status: ${version.status}`,
      );
    }

    const existing = await this.rolloutRepo.findOne({
      where: {
        policyVersionId: dto.policyVersionId,
        status: RolloutStatus.CANARY,
      },
    });
    if (existing) {
      throw new BadRequestException(
        `A canary rollout is already in progress for version ${dto.policyVersionId}`,
      );
    }

    const canaryPercent = dto.canaryPercent ?? 5;
    const rollout = this.rolloutRepo.create({
      policyVersionId: dto.policyVersionId,
      canaryPercent,
      stepPercent: dto.stepPercent ?? 25,
      canaryWindowMinutes: dto.canaryWindowMinutes ?? 30,
      errorRateThreshold: dto.errorRateThreshold ?? 0.05,
      currentPercent: canaryPercent,
      status: RolloutStatus.CANARY,
      canaryEvaluation: 'pending',
      canaryStartedAt: new Date(),
      startedBy: actor,
    });

    const saved = await this.rolloutRepo.save(rollout);

    this.logger.log(
      `[Rollout] Started canary rollout id=${saved.id} for policyVersion=${dto.policyVersionId} at ${canaryPercent}%`,
    );

    return saved;
  }

  /**
   * Record a canary metric snapshot for a rollout.
   * Called by the application layer (e.g. notification processor, request handlers)
   * to feed error-rate data into the evaluation window.
   */
  async recordMetric(
    rolloutId: string,
    totalRequests: number,
    errorCount: number,
    avgLatencyMs?: number,
    p99LatencyMs?: number,
    extra?: Record<string, any>,
  ): Promise<CanaryMetricEntity> {
    const rollout = await this.rolloutRepo.findOne({
      where: { id: rolloutId },
    });
    if (!rollout) throw new NotFoundException(`Rollout ${rolloutId} not found`);

    const errorRate = totalRequests > 0 ? errorCount / totalRequests : 0;

    const metric = this.metricsRepo.create({
      rolloutId,
      policyVersionId: rollout.policyVersionId,
      totalRequests,
      errorCount,
      errorRate,
      avgLatencyMs: avgLatencyMs ?? null,
      p99LatencyMs: p99LatencyMs ?? null,
      extra: extra ?? null,
      recordedAt: new Date(),
    });

    return this.metricsRepo.save(metric);
  }

  /**
   * Evaluate the canary window for all active canary rollouts.
   * Runs every minute via cron. Promotes or aborts based on error rate.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async evaluateCanaries(): Promise<void> {
    const activeCanaries = await this.rolloutRepo.find({
      where: { status: RolloutStatus.CANARY },
    });

    for (const rollout of activeCanaries) {
      await this.evaluateSingleCanary(rollout);
    }
  }

  private async evaluateSingleCanary(
    rollout: PolicyRolloutEntity,
  ): Promise<void> {
    if (!rollout.canaryStartedAt) return;

    const windowEnd = new Date(
      rollout.canaryStartedAt.getTime() + rollout.canaryWindowMinutes * 60_000,
    );

    if (new Date() < windowEnd) {
      // Still within the evaluation window — check for early abort
      await this.checkEarlyAbort(rollout);
      return;
    }

    // Window has elapsed — compute aggregate metrics
    const metrics = await this.metricsRepo.find({
      where: { rolloutId: rollout.id },
      order: { recordedAt: 'ASC' },
    });

    const totalRequests = metrics.reduce((s, m) => s + m.totalRequests, 0);
    const totalErrors = metrics.reduce((s, m) => s + m.errorCount, 0);
    const aggregateErrorRate =
      totalRequests > 0 ? totalErrors / totalRequests : 0;

    const passed = aggregateErrorRate <= rollout.errorRateThreshold;

    rollout.canaryMetrics = {
      totalRequests,
      totalErrors,
      aggregateErrorRate,
      threshold: rollout.errorRateThreshold,
      windowMinutes: rollout.canaryWindowMinutes,
      evaluatedAt: new Date().toISOString(),
    };

    if (passed) {
      rollout.canaryEvaluation = 'passed';
      rollout.status = RolloutStatus.EXPANDING;
      rollout.currentPercent = Math.min(
        rollout.currentPercent + rollout.stepPercent,
        100,
      );
      await this.rolloutRepo.save(rollout);

      this.logger.log(
        `[Rollout] Canary PASSED for rollout=${rollout.id} errorRate=${aggregateErrorRate.toFixed(4)} — expanding to ${rollout.currentPercent}%`,
      );

      if (rollout.currentPercent >= 100) {
        await this.promoteToFull(rollout);
      }
    } else {
      rollout.canaryEvaluation = 'failed';
      await this.rolloutRepo.save(rollout);

      this.logger.warn(
        `[Rollout] Canary FAILED for rollout=${rollout.id} errorRate=${aggregateErrorRate.toFixed(4)} > threshold=${rollout.errorRateThreshold} — auto-aborting`,
      );

      await this.emergencyRollback(
        rollout.id,
        'system',
        'Canary evaluation failed: error rate exceeded threshold',
      );
    }
  }

  private async checkEarlyAbort(rollout: PolicyRolloutEntity): Promise<void> {
    // Compute rolling error rate from the last 5 minutes of metrics
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
    const recent = await this.metricsRepo
      .createQueryBuilder('m')
      .where('m.rollout_id = :id', { id: rollout.id })
      .andWhere('m.recorded_at >= :since', { since: fiveMinutesAgo })
      .getMany();

    if (recent.length === 0) return;

    const totalRequests = recent.reduce((s, m) => s + m.totalRequests, 0);
    const totalErrors = recent.reduce((s, m) => s + m.errorCount, 0);
    const recentErrorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

    // Early abort if error rate is 3× the threshold
    if (recentErrorRate > rollout.errorRateThreshold * 3) {
      this.logger.warn(
        `[Rollout] Early abort triggered for rollout=${rollout.id} recentErrorRate=${recentErrorRate.toFixed(4)}`,
      );
      await this.emergencyRollback(
        rollout.id,
        'system',
        `Early abort: recent error rate ${recentErrorRate.toFixed(4)} exceeded 3× threshold`,
      );
    }
  }

  /**
   * Manually advance the rollout to the next traffic percentage step.
   */
  async advanceStep(
    rolloutId: string,
    actor: string,
  ): Promise<PolicyRolloutEntity> {
    const rollout = await this.getRollout(rolloutId);

    if (
      ![RolloutStatus.CANARY, RolloutStatus.EXPANDING].includes(rollout.status)
    ) {
      throw new BadRequestException(
        `Rollout ${rolloutId} is not in an advanceable state`,
      );
    }

    rollout.currentPercent = Math.min(
      rollout.currentPercent + rollout.stepPercent,
      100,
    );

    if (rollout.currentPercent >= 100) {
      await this.promoteToFull(rollout);
    } else {
      rollout.status = RolloutStatus.EXPANDING;
      await this.rolloutRepo.save(rollout);
    }

    this.logger.log(
      `[Rollout] Advanced rollout=${rolloutId} to ${rollout.currentPercent}% by actor=${actor}`,
    );

    return rollout;
  }

  /**
   * Emergency rollback: abort the rollout and revert to the previous active policy version.
   */
  async emergencyRollback(
    rolloutId: string,
    actor: string,
    reason: string,
  ): Promise<{
    rollout: PolicyRolloutEntity;
    revertedToVersionId: string | null;
  }> {
    const rollout = await this.getRollout(rolloutId);

    if (
      [RolloutStatus.ROLLED_BACK, RolloutStatus.ABORTED].includes(
        rollout.status,
      )
    ) {
      throw new BadRequestException(
        `Rollout ${rolloutId} is already ${rollout.status}`,
      );
    }

    const targetVersion = await this.policyRepo.findOne({
      where: { id: rollout.policyVersionId },
    });

    // Find the previously active version for this policy
    let revertedToVersionId: string | null = null;
    if (targetVersion) {
      const previousActive = await this.policyRepo
        .createQueryBuilder('p')
        .where('p.policy_name = :name', { name: targetVersion.policyName })
        .andWhere('p.status = :status', { status: PolicyVersionStatus.ACTIVE })
        .andWhere('p.id != :id', { id: targetVersion.id })
        .orderBy('p.version', 'DESC')
        .getOne();

      revertedToVersionId = previousActive?.id ?? null;
    }

    rollout.status = RolloutStatus.ROLLED_BACK;
    rollout.rolledBackBy = actor;
    rollout.rollbackReason = reason;
    rollout.rollbackToVersionId = revertedToVersionId;
    await this.rolloutRepo.save(rollout);

    this.logger.warn(
      `[Rollout] Emergency rollback for rollout=${rolloutId} by actor=${actor}: ${reason}`,
    );

    return { rollout, revertedToVersionId };
  }

  private async promoteToFull(rollout: PolicyRolloutEntity): Promise<void> {
    rollout.status = RolloutStatus.FULL;
    rollout.currentPercent = 100;
    rollout.fullRolloutAt = new Date();
    await this.rolloutRepo.save(rollout);

    // Activate the policy version
    const version = await this.policyRepo.findOne({
      where: { id: rollout.policyVersionId },
    });
    if (version && version.status === PolicyVersionStatus.DRAFT) {
      // Supersede the current active version
      const currentActive = await this.policyRepo.findOne({
        where: {
          policyName: version.policyName,
          status: PolicyVersionStatus.ACTIVE,
        },
        order: { version: 'DESC' },
      });

      if (currentActive) {
        currentActive.status = PolicyVersionStatus.SUPERSEDED;
        currentActive.effectiveTo = new Date();
        await this.policyRepo.save(currentActive);
      }

      version.status = PolicyVersionStatus.ACTIVE;
      version.activatedAt = new Date();
      version.activatedBy = rollout.startedBy;
      await this.replayService.lockSnapshot(version);
    }

    this.logger.log(
      `[Rollout] Full rollout complete for rollout=${rollout.id} policyVersion=${rollout.policyVersionId}`,
    );
  }

  async getRollout(rolloutId: string): Promise<PolicyRolloutEntity> {
    const rollout = await this.rolloutRepo.findOne({
      where: { id: rolloutId },
    });
    if (!rollout) throw new NotFoundException(`Rollout ${rolloutId} not found`);
    return rollout;
  }

  async listRollouts(policyVersionId?: string): Promise<PolicyRolloutEntity[]> {
    const where: Record<string, any> = {};
    if (policyVersionId) where.policyVersionId = policyVersionId;
    return this.rolloutRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async getSummary(rolloutId: string): Promise<RolloutSummary> {
    const rollout = await this.getRollout(rolloutId);
    return {
      rolloutId: rollout.id,
      policyVersionId: rollout.policyVersionId,
      status: rollout.status,
      currentPercent: rollout.currentPercent,
      canaryEvaluation: rollout.canaryEvaluation,
      canaryMetrics: rollout.canaryMetrics,
    };
  }
}
