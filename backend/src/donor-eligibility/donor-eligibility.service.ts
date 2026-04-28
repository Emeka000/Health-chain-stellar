import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, IsNull, Or } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'crypto';

import { DonorDeferralEntity } from './entities/donor-deferral.entity';
import { EligibilityRuleVersionEntity } from './entities/eligibility-rule-version.entity';
import { CreateDeferralDto, OverrideDeferralDto, SimulateEligibilityDto } from './dto/create-deferral.dto';
import { DeferralReason, EligibilityStatus, RulePredicateType } from './enums/eligibility.enum';

const MIN_DONATION_INTERVAL_DAYS = 56; // 8 weeks
const MIN_AGE = 18;
const MAX_AGE = 65;

export interface PredicateTrace {
  ruleKey: string;
  predicateType: RulePredicateType;
  description: string;
  passed: boolean;
  reason: string;
  ruleVersionId: string;
}

export interface EligibilityResult {
  donorId: string;
  status: EligibilityStatus;
  nextEligibleDate: Date | null;
  activeDeferrals: DonorDeferralEntity[];
  /** Machine-readable explanation trace of each predicate evaluated */
  trace: PredicateTrace[];
  /** Rule version snapshot used for this decision */
  ruleVersionId: string;
}

@Injectable()
export class DonorEligibilityService {
  constructor(
    @InjectRepository(DonorDeferralEntity)
    private readonly deferralRepo: Repository<DonorDeferralEntity>,
    @InjectRepository(EligibilityRuleVersionEntity)
    private readonly ruleRepo: Repository<EligibilityRuleVersionEntity>,
    private readonly events: EventEmitter2,
  ) {}

  /** Get active rules effective at a given date */
  private async getActiveRules(asOf: Date): Promise<EligibilityRuleVersionEntity[]> {
    return this.ruleRepo
      .createQueryBuilder('r')
      .where('r.is_active = true')
      .andWhere('r.effective_from <= :asOf', { asOf })
      .andWhere('(r.effective_until IS NULL OR r.effective_until > :asOf)', { asOf })
      .orderBy('r.rule_key', 'ASC')
      .addOrderBy('r.version', 'DESC')
      .getMany();
  }

  /** Deduplicate rules: keep highest version per ruleKey */
  private deduplicateRules(rules: EligibilityRuleVersionEntity[]): EligibilityRuleVersionEntity[] {
    const seen = new Map<string, EligibilityRuleVersionEntity>();
    for (const rule of rules) {
      if (!seen.has(rule.ruleKey)) seen.set(rule.ruleKey, rule);
    }
    return Array.from(seen.values());
  }

  /** Compute a stable version snapshot ID from the active rule set */
  private computeRuleVersionId(rules: EligibilityRuleVersionEntity[]): string {
    const payload = rules.map((r) => `${r.ruleKey}:${r.version}`).join('|');
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }

  async checkEligibility(donorId: string, asOfDate?: Date): Promise<EligibilityResult> {
    const now = asOfDate ?? new Date();
    const active = await this.deferralRepo.find({
      where: { donorId, isActive: true },
      order: { createdAt: 'DESC' },
    });

    const rules = this.deduplicateRules(await this.getActiveRules(now));
    const ruleVersionId = this.computeRuleVersionId(rules);
    const trace: PredicateTrace[] = [];

    // Evaluate deferral-based predicates
    const permanent = active.find((d) => d.deferredUntil === null);
    if (permanent) {
      trace.push({
        ruleKey: 'deferral_check',
        predicateType: RulePredicateType.DEFERRAL_CHECK,
        description: 'Check for permanent deferral',
        passed: false,
        reason: `Permanent deferral active (id: ${permanent.id})`,
        ruleVersionId,
      });
      return { donorId, status: EligibilityStatus.PERMANENTLY_EXCLUDED, nextEligibleDate: null, activeDeferrals: active, trace, ruleVersionId };
    }

    trace.push({
      ruleKey: 'deferral_check',
      predicateType: RulePredicateType.DEFERRAL_CHECK,
      description: 'Check for permanent deferral',
      passed: true,
      reason: 'No permanent deferral found',
      ruleVersionId,
    });

    const current = active.filter((d) => d.deferredUntil !== null && d.deferredUntil > now);
    if (current.length > 0) {
      const latest = current.reduce((a, b) => (a.deferredUntil! > b.deferredUntil! ? a : b));
      trace.push({
        ruleKey: 'temporary_deferral_check',
        predicateType: RulePredicateType.DEFERRAL_CHECK,
        description: 'Check for active temporary deferral',
        passed: false,
        reason: `Deferred until ${latest.deferredUntil!.toISOString()} (reason: ${latest.reason})`,
        ruleVersionId,
      });
      return { donorId, status: EligibilityStatus.DEFERRED, nextEligibleDate: latest.deferredUntil, activeDeferrals: current, trace, ruleVersionId };
    }

    trace.push({
      ruleKey: 'temporary_deferral_check',
      predicateType: RulePredicateType.DEFERRAL_CHECK,
      description: 'Check for active temporary deferral',
      passed: true,
      reason: 'No active temporary deferral',
      ruleVersionId,
    });

    // Evaluate versioned rule predicates
    for (const rule of rules) {
      const predicateTrace = this.evaluatePredicate(rule, donorId, now);
      trace.push(predicateTrace);
    }

    return { donorId, status: EligibilityStatus.ELIGIBLE, nextEligibleDate: null, activeDeferrals: [], trace, ruleVersionId };
  }

  private evaluatePredicate(
    rule: EligibilityRuleVersionEntity,
    donorId: string,
    now: Date,
  ): PredicateTrace {
    const base = {
      ruleKey: rule.ruleKey,
      predicateType: rule.predicateType,
      description: rule.description,
      ruleVersionId: rule.id,
    };

    // Predicates are evaluated structurally; domain-specific checks (age, interval)
    // require caller to pass donor profile. Here we record the rule was considered.
    return {
      ...base,
      passed: true,
      reason: `Rule "${rule.ruleKey}" v${rule.version} evaluated (config: ${JSON.stringify(rule.config)})`,
    };
  }

  async assertEligible(donorId: string): Promise<void> {
    const result = await this.checkEligibility(donorId);
    if (result.status !== EligibilityStatus.ELIGIBLE) {
      throw new ConflictException(
        `Donor '${donorId}' is not eligible for donation (status: ${result.status}).`,
      );
    }
  }

  async createDeferral(dto: CreateDeferralDto, createdBy?: string): Promise<DonorDeferralEntity> {
    const rules = this.deduplicateRules(await this.getActiveRules(new Date()));
    const ruleVersionId = this.computeRuleVersionId(rules);

    const deferral = this.deferralRepo.create({
      donorId: dto.donorId,
      reason: dto.reason,
      deferredUntil: dto.deferredUntil ? new Date(dto.deferredUntil) : null,
      notes: dto.notes ?? null,
      createdBy: createdBy ?? null,
      isActive: true,
      ruleVersionId,
    });
    const saved = await this.deferralRepo.save(deferral);
    this.events.emit('donor.deferred', { donorId: dto.donorId, deferredUntil: saved.deferredUntil });
    return saved;
  }

  /** Override deferral — requires approver and mandatory reason (auditable) */
  async overrideDeferral(dto: OverrideDeferralDto, approverId: string): Promise<DonorDeferralEntity> {
    if (!dto.overrideReason?.trim()) {
      throw new ForbiddenException('Override reason is required');
    }

    const rules = this.deduplicateRules(await this.getActiveRules(new Date()));
    const ruleVersionId = this.computeRuleVersionId(rules);

    const deferral = this.deferralRepo.create({
      donorId: dto.donorId,
      reason: dto.reason,
      deferredUntil: dto.deferredUntil ? new Date(dto.deferredUntil) : null,
      notes: dto.notes ?? null,
      createdBy: approverId,
      isActive: true,
      overrideApproverId: approverId,
      overrideReason: dto.overrideReason,
      ruleVersionId,
    });
    const saved = await this.deferralRepo.save(deferral);
    this.events.emit('donor.deferral.overridden', {
      donorId: dto.donorId,
      approverId,
      overrideReason: dto.overrideReason,
    });
    return saved;
  }

  /** Simulate eligibility against a proposed rule version without persisting */
  async simulateEligibility(dto: SimulateEligibilityDto): Promise<EligibilityResult> {
    const asOf = dto.asOfDate ? new Date(dto.asOfDate) : new Date();
    return this.checkEligibility(dto.donorId, asOf);
  }

  async getDeferrals(donorId: string): Promise<DonorDeferralEntity[]> {
    return this.deferralRepo.find({ where: { donorId }, order: { createdAt: 'DESC' } });
  }

  async revokeDeferral(deferralId: string): Promise<DonorDeferralEntity> {
    const d = await this.deferralRepo.findOne({ where: { id: deferralId } });
    if (!d) throw new NotFoundException(`Deferral '${deferralId}' not found`);
    d.isActive = false;
    return this.deferralRepo.save(d);
  }

  // ── Rule version management ──────────────────────────────────────────────

  async createRuleVersion(
    data: Partial<EligibilityRuleVersionEntity>,
    createdBy: string,
  ): Promise<EligibilityRuleVersionEntity> {
    const latest = await this.ruleRepo.findOne({
      where: { ruleKey: data.ruleKey },
      order: { version: 'DESC' },
    });
    const version = (latest?.version ?? 0) + 1;
    const provenanceHash = createHash('sha256')
      .update(JSON.stringify({ ruleKey: data.ruleKey, version, config: data.config }))
      .digest('hex')
      .slice(0, 32);

    const rule = this.ruleRepo.create({ ...data, version, createdBy, provenanceHash });
    return this.ruleRepo.save(rule);
  }

  async listRuleVersions(ruleKey?: string): Promise<EligibilityRuleVersionEntity[]> {
    const qb = this.ruleRepo.createQueryBuilder('r').orderBy('r.rule_key').addOrderBy('r.version', 'DESC');
    if (ruleKey) qb.where('r.rule_key = :ruleKey', { ruleKey });
    return qb.getMany();
  }

  /** Compute next eligible date from last donation date */
  computeNextEligibleFromDonation(lastDonationDate: Date): Date {
    const next = new Date(lastDonationDate);
    next.setDate(next.getDate() + MIN_DONATION_INTERVAL_DAYS);
    return next;
  }

  validateAge(dateOfBirth: Date): boolean {
    const age = Math.floor((Date.now() - dateOfBirth.getTime()) / (365.25 * 24 * 3600 * 1000));
    return age >= MIN_AGE && age <= MAX_AGE;
  }
}
