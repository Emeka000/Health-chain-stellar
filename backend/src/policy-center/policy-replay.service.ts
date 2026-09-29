import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { EntityManager, Repository } from 'typeorm';

import { PolicyVersionEntity } from './entities/policy-version.entity';
import { PolicyVersionStatus } from './enums/policy-version-status.enum';
import { OperationalPolicyRules } from './policy-config.types';

/**
 * Recursively sorts object keys so that semantically equal rule sets always
 * serialize identically. Array order is preserved (it is significant).
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

export interface DriftEntry {
  path: string;
  archivedValue: unknown;
  currentValue: unknown;
}

export interface ReplayResult {
  policyVersionId: string;
  version: number;
  policyName: string;
  rulesHash: string;
  archivedRules: OperationalPolicyRules;
  currentRules: OperationalPolicyRules | null;
  driftReport: DriftEntry[];
  hasDrift: boolean;
  replayedAt: string;
}

@Injectable()
export class PolicyReplayService {
  constructor(
    @InjectRepository(PolicyVersionEntity)
    private readonly repo: Repository<PolicyVersionEntity>,
  ) {}

  computeRulesHash(rules: OperationalPolicyRules): string {
    return createHash('sha256')
      .update(JSON.stringify(canonicalize(rules)))
      .digest('hex');
  }

  /** Replay a historical decision using the archived snapshot (Issue #618). */
  async replay(policyVersionId: string): Promise<ReplayResult> {
    const archived = await this.repo.findOne({ where: { id: policyVersionId } });
    if (!archived) throw new NotFoundException(`Policy version '${policyVersionId}' not found`);
    if (!archived.immutable) {
      throw new BadRequestException(
        `Policy version '${policyVersionId}' is not yet activated/locked`,
      );
    }

    const archivedHash = archived.rulesHash ?? this.computeRulesHash(archived.rules);

    const current = await this.repo.findOne({
      where: { policyName: archived.policyName, status: PolicyVersionStatus.ACTIVE },
      order: { version: 'DESC' },
    });

    const currentRules = current?.rules ?? null;
    const driftReport = currentRules ? this.buildDrift(archived.rules, currentRules) : [];

    return {
      policyVersionId: archived.id,
      version: archived.version,
      policyName: archived.policyName,
      rulesHash: archivedHash,
      archivedRules: archived.rules,
      currentRules,
      driftReport,
      hasDrift: driftReport.length > 0,
      replayedAt: new Date().toISOString(),
    };
  }

  /** Lock snapshot as immutable and persist rules hash on activation (Issue #618). */
  async lockSnapshot(
    entity: PolicyVersionEntity,
    manager?: EntityManager,
  ): Promise<PolicyVersionEntity> {
    entity.rulesHash = this.computeRulesHash(entity.rules);
    entity.immutable = true;
    const repo = manager ? manager.getRepository(PolicyVersionEntity) : this.repo;
    return repo.save(entity);
  }

  /** Throw if entity is already immutable (prevents edits to historical snapshots). */
  assertMutable(entity: PolicyVersionEntity): void {
    if (entity.immutable) {
      throw new BadRequestException(
        `Policy version '${entity.id}' is immutable and cannot be edited`,
      );
    }
  }

  private buildDrift(a: OperationalPolicyRules, b: OperationalPolicyRules): DriftEntry[] {
    const entries: DriftEntry[] = [];
    const walk = (av: unknown, bv: unknown, path: string) => {
      if (av !== null && typeof av === 'object' && bv !== null && typeof bv === 'object') {
        const keys = new Set([
          ...Object.keys(av as Record<string, unknown>),
          ...Object.keys(bv as Record<string, unknown>),
        ]);
        for (const k of keys) {
          walk(
            (av as Record<string, unknown>)[k],
            (bv as Record<string, unknown>)[k],
            path ? `${path}.${k}` : k,
          );
        }
        return;
      }
      if (av !== bv) entries.push({ path, archivedValue: av, currentValue: bv });
    };
    walk(a, b, '');
    return entries;
  }
}
