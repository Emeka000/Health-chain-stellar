import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreatePolicyVersionDto } from './dto/create-policy-version.dto';
import { ListPolicyVersionsDto } from './dto/list-policy-versions.dto';
import { UpdatePolicyVersionDto } from './dto/update-policy-version.dto';
import { PolicyVersionEntity } from './entities/policy-version.entity';
import { PolicyVersionStatus } from './enums/policy-version-status.enum';
import { PolicyReplayService } from './policy-replay.service';
import { ActivePolicySnapshot, OperationalPolicyRules } from './policy-config.types';

@Injectable()
export class PolicyCenterService {
  private readonly defaultPolicyName = 'operational-core';

  constructor(
    @InjectRepository(PolicyVersionEntity)
    private readonly repo: Repository<PolicyVersionEntity>,
    private readonly replayService: PolicyReplayService,
  ) {}

  getDefaultRules(): OperationalPolicyRules {
    return {
      anomaly: {
        duplicateEmergencyMinCount: 3,
        riderMinOrders: 5,
        riderCancellationRatioThreshold: 0.4,
        disputeCountThreshold: 3,
        stockSwingWindowMinutes: 60,
        stockSwingMinOrders: 10,
      },
      dispatch: {
        acceptanceTimeoutMs: 180000,
        distanceWeight: 0.5,
        workloadWeight: 0.3,
        ratingWeight: 0.2,
      },
      inventory: {
        expiringSoonHours: 72,
      },
      notification: {
        defaultQuietHoursEnabled: false,
        defaultQuietHoursStart: '22:00',
        defaultQuietHoursEnd: '06:00',
        defaultEmergencyBypassTier: 'normal',
      },
      quarantine: {
        triggerMatrix: {
          temperatureBreach: {
            enabled: true,
            minTempC: 2,
            maxTempC: 6,
            autoQuarantine: true,
            requiredEvidence: ['temperature_log', 'sensor_reading'],
          },
          contaminationSuspected: {
            enabled: true,
            autoQuarantine: false,
            requiredEvidence: ['lab_report', 'visual_inspection'],
            approvalRequired: true,
          },
          manualOperatorAction: {
            enabled: true,
            requiredEvidence: ['operator_notes'],
            approvalRequired: false,
          },
          anomalyDetection: {
            enabled: true,
            autoQuarantine: true,
            requiredEvidence: ['anomaly_report'],
          },
        },
        dispositionRules: {
          temperatureBreach: {
            defaultDisposition: 'RELEASE',
            autoApproveThresholdHours: 24,
            requiredApprovals: 1,
          },
          contaminationSuspected: {
            defaultDisposition: 'DISCARD',
            requiredApprovals: 2,
          },
          manualOperatorAction: {
            defaultDisposition: 'RELEASE',
            requiredApprovals: 1,
          },
          anomalyDetection: {
            defaultDisposition: 'RELEASE',
            autoApproveThresholdHours: 48,
            requiredApprovals: 1,
          },
        },
        evidenceRequirements: {
          minimumEvidenceCount: 1,
          allowedEvidenceTypes: ['image', 'document', 'log', 'report'],
          maxEvidenceSizeMb: 10,
        },
      },
    };
  }

  async listVersions(query: ListPolicyVersionsDto): Promise<PolicyVersionEntity[]> {
    await this.ensureBaselinePolicy(query.policyName ?? this.defaultPolicyName);

    const qb = this.repo.createQueryBuilder('p').orderBy('p.version', 'DESC');
    qb.andWhere('p.policy_name = :policyName', {
      policyName: query.policyName ?? this.defaultPolicyName,
    });

    if (query.status) {
      qb.andWhere('p.status = :status', { status: query.status });
    }

    return qb.getMany();
  }

  async getVersion(id: string): Promise<PolicyVersionEntity> {
    const found = await this.repo.findOne({ where: { id } });
    if (!found) {
      throw new NotFoundException(`Policy version ${id} not found`);
    }
    return found;
  }

  async createVersion(
    dto: CreatePolicyVersionDto,
    actor: string,
  ): Promise<PolicyVersionEntity> {
    const policyName = dto.policyName ?? this.defaultPolicyName;
    await this.ensureBaselinePolicy(policyName);

    const currentMaxVersion = await this.repo
      .createQueryBuilder('p')
      .select('COALESCE(MAX(p.version), 0)', 'max')
      .where('p.policy_name = :policyName', { policyName })
      .getRawOne<{ max: string }>();

    const active = await this.getActivePolicySnapshot(policyName);
    const baseRules = active.rules;
    const mergedRules = this.mergeRules(baseRules, dto.rules);

    this.validateRules(mergedRules);
    this.validateEffectiveDates(dto.effectiveFrom, dto.effectiveTo);

    const entity = this.repo.create({
      policyName,
      version: Number(currentMaxVersion?.max ?? 0) + 1,
      status: PolicyVersionStatus.DRAFT,
      rules: mergedRules,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
      effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      changeSummary: dto.changeSummary ?? null,
      createdBy: actor,
    });

    return this.repo.save(entity);
  }

  async updateVersion(
    id: string,
    dto: UpdatePolicyVersionDto,
  ): Promise<PolicyVersionEntity> {
    const existing = await this.getVersion(id);

    if (existing.status !== PolicyVersionStatus.DRAFT) {
      throw new BadRequestException('Only draft versions can be edited');
    }

    // Immutability guard (Issue #618)
    this.replayService.assertMutable(existing);

    if (dto.rules) {
      existing.rules = this.mergeRules(existing.rules, dto.rules);
      this.validateRules(existing.rules);
    }

    if (dto.effectiveFrom !== undefined) {
      existing.effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null;
    }

    if (dto.effectiveTo !== undefined) {
      existing.effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    }

    this.validateEffectiveDates(
      existing.effectiveFrom?.toISOString(),
      existing.effectiveTo?.toISOString(),
    );

    if (dto.changeSummary !== undefined) {
      existing.changeSummary = dto.changeSummary ?? null;
    }

    return this.repo.save(existing);
  }

  async activateVersion(id: string, actor: string): Promise<PolicyVersionEntity> {
    const target = await this.getVersion(id);
    this.validateRules(target.rules);

    const now = new Date();
    if (target.effectiveFrom && target.effectiveFrom > now) {
      throw new BadRequestException('Cannot activate a version before effectiveFrom');
    }

    if (target.effectiveTo && target.effectiveTo <= now) {
      throw new BadRequestException('Cannot activate an already-expired version');
    }

    const currentlyActive = await this.repo.findOne({
      where: {
        policyName: target.policyName,
        status: PolicyVersionStatus.ACTIVE,
      },
      order: { version: 'DESC' },
    });

    if (currentlyActive && currentlyActive.id !== target.id) {
      currentlyActive.status = PolicyVersionStatus.SUPERSEDED;
      currentlyActive.effectiveTo = now;
      await this.repo.save(currentlyActive);
    }

    target.status = PolicyVersionStatus.ACTIVE;
    target.activatedAt = now;
    target.activatedBy = actor;

    // Lock snapshot: persist rules hash and mark immutable (Issue #618)
    return this.replayService.lockSnapshot(target);
  }

  async rollbackToVersion(id: string, actor: string): Promise<PolicyVersionEntity> {
    const target = await this.getVersion(id);

    const currentlyActive = await this.repo.findOne({
      where: {
        policyName: target.policyName,
        status: PolicyVersionStatus.ACTIVE,
      },
      order: { version: 'DESC' },
    });

    if (currentlyActive && currentlyActive.id !== target.id) {
      currentlyActive.status = PolicyVersionStatus.ROLLED_BACK;
      currentlyActive.effectiveTo = new Date();
      currentlyActive.rollbackFromVersionId = target.id;
      await this.repo.save(currentlyActive);
    }

    return this.activateVersion(id, actor);
  }

  async getActivePolicySnapshot(
    policyName: string = this.defaultPolicyName,
  ): Promise<ActivePolicySnapshot> {
    await this.ensureBaselinePolicy(policyName);

    const now = new Date();

    const active = await this.repo
      .createQueryBuilder('p')
      .where('p.policy_name = :policyName', { policyName })
      .andWhere('p.status = :status', { status: PolicyVersionStatus.ACTIVE })
      .andWhere('(p.effective_from IS NULL OR p.effective_from <= :now)', { now })
      .andWhere('(p.effective_to IS NULL OR p.effective_to > :now)', { now })
      .orderBy('p.version', 'DESC')
      .getOne();

    if (!active) {
      throw new NotFoundException('No active policy version found');
    }

    return {
      policyVersionId: active.id,
      version: active.version,
      policyName: active.policyName,
      rules: active.rules,
    };
  }

  async compareVersions(fromVersionId: string, toVersionId: string): Promise<{
    fromVersionId: string;
    toVersionId: string;
    changedKeys: string[];
  }> {
    const from = await this.getVersion(fromVersionId);
    const to = await this.getVersion(toVersionId);

    const changedKeys = this.diffRules(from.rules, to.rules);

    return {
      fromVersionId,
      toVersionId,
      changedKeys,
    };
  }

  private async ensureBaselinePolicy(policyName: string): Promise<void> {
    const activeExists = await this.repo.findOne({
      where: {
        policyName,
        status: PolicyVersionStatus.ACTIVE,
      },
    });

    if (activeExists) {
      return;
    }

    const currentMaxVersion = await this.repo
      .createQueryBuilder('p')
      .select('COALESCE(MAX(p.version), 0)', 'max')
      .where('p.policy_name = :policyName', { policyName })
      .getRawOne<{ max: string }>();

    const baseline = this.repo.create({
      policyName,
      version: Number(currentMaxVersion?.max ?? 0) + 1,
      status: PolicyVersionStatus.ACTIVE,
      rules: this.getDefaultRules(),
      effectiveFrom: new Date(),
      createdBy: 'system',
      activatedBy: 'system',
      activatedAt: new Date(),
      changeSummary: 'System baseline policy',
    });

    await this.repo.save(baseline);
  }

  private validateEffectiveDates(
    effectiveFrom?: string,
    effectiveTo?: string,
  ): void {
    if (!effectiveFrom || !effectiveTo) {
      return;
    }

    if (new Date(effectiveTo) <= new Date(effectiveFrom)) {
      throw new BadRequestException('effectiveTo must be later than effectiveFrom');
    }
  }

  private validateRules(rules: OperationalPolicyRules): void {
    const positiveFields: Array<{ name: string; value: number }> = [
      {
        name: 'anomaly.duplicateEmergencyMinCount',
        value: rules.anomaly.duplicateEmergencyMinCount,
      },
      {
        name: 'anomaly.riderMinOrders',
        value: rules.anomaly.riderMinOrders,
      },
      {
        name: 'anomaly.disputeCountThreshold',
        value: rules.anomaly.disputeCountThreshold,
      },
      {
        name: 'anomaly.stockSwingWindowMinutes',
        value: rules.anomaly.stockSwingWindowMinutes,
      },
      {
        name: 'anomaly.stockSwingMinOrders',
        value: rules.anomaly.stockSwingMinOrders,
      },
      {
        name: 'dispatch.acceptanceTimeoutMs',
        value: rules.dispatch.acceptanceTimeoutMs,
      },
      {
        name: 'inventory.expiringSoonHours',
        value: rules.inventory.expiringSoonHours,
      },
    ];

    for (const field of positiveFields) {
      if (!Number.isFinite(field.value) || field.value <= 0) {
        throw new BadRequestException(`${field.name} must be greater than 0`);
      }
    }

    if (
      rules.anomaly.riderCancellationRatioThreshold < 0 ||
      rules.anomaly.riderCancellationRatioThreshold > 1
    ) {
      throw new BadRequestException(
        'anomaly.riderCancellationRatioThreshold must be between 0 and 1',
      );
    }

    const weightSum =
      rules.dispatch.distanceWeight +
      rules.dispatch.workloadWeight +
      rules.dispatch.ratingWeight;

    if (weightSum <= 0) {
      throw new BadRequestException('dispatch weights must sum to a positive number');
    }

    const quietHoursPattern = /^\d{2}:\d{2}$/;
    if (
      !quietHoursPattern.test(rules.notification.defaultQuietHoursStart) ||
      !quietHoursPattern.test(rules.notification.defaultQuietHoursEnd)
    ) {
      throw new BadRequestException('notification quiet-hours must use HH:MM format');
    }
  }

  private mergeRules(
    base: OperationalPolicyRules,
    patch: Record<string, unknown>,
  ): OperationalPolicyRules {
    const next = JSON.parse(JSON.stringify(base)) as Record<string, any>;

    const deepMerge = (target: Record<string, any>, source: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(source)) {
        if (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          typeof target[key] === 'object' &&
          target[key] !== null
        ) {
          deepMerge(target[key], value as Record<string, unknown>);
          continue;
        }
        target[key] = value;
      }
    };

    deepMerge(next, patch);
    return next as OperationalPolicyRules;
  }

  private diffRules(
    fromRules: OperationalPolicyRules,
    toRules: OperationalPolicyRules,
  ): string[] {
    const changes: string[] = [];

    const walk = (fromValue: unknown, toValue: unknown, path: string) => {
      if (
        fromValue !== null &&
        typeof fromValue === 'object' &&
        toValue !== null &&
        typeof toValue === 'object'
      ) {
        const keys = new Set([
          ...Object.keys(fromValue as Record<string, unknown>),
          ...Object.keys(toValue as Record<string, unknown>),
        ]);

        for (const key of keys) {
          const nextPath = path ? `${path}.${key}` : key;
          walk(
            (fromValue as Record<string, unknown>)[key],
            (toValue as Record<string, unknown>)[key],
            nextPath,
          );
        }
        return;
      }

      if (fromValue !== toValue) {
        changes.push(path);
      }
    };

    walk(fromRules, toRules, '');
    return changes.filter(Boolean).sort();
  }
}
