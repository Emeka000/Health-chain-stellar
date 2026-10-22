import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { RulePredicateType } from '../enums/eligibility.enum';

/**
 * A versioned eligibility rule with effective date range.
 * Rules are composable predicates evaluated in order.
 */
@Entity('eligibility_rule_versions')
@Index(['ruleKey', 'effectiveFrom'])
@Index(['isActive'])
export class EligibilityRuleVersionEntity extends BaseEntity {
  /** Stable identifier across versions, e.g. "age_range", "donation_interval" */
  @Column({ name: 'rule_key', type: 'varchar' })
  ruleKey: string;

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'predicate_type', type: 'enum', enum: RulePredicateType })
  predicateType: RulePredicateType;

  /** Human-readable description of what this rule checks */
  @Column({ name: 'description', type: 'text' })
  description: string;

  /** JSON config for the predicate, e.g. { minAge: 18, maxAge: 65 } */
  @Column({ name: 'config', type: 'jsonb' })
  config: Record<string, unknown>;

  /** When this version becomes effective */
  @Column({ name: 'effective_from', type: 'timestamptz' })
  effectiveFrom: Date;

  /** When this version expires (null = still active) */
  @Column({ name: 'effective_until', type: 'timestamptz', nullable: true })
  effectiveUntil: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Who created/published this rule version */
  @Column({ name: 'created_by', type: 'varchar', nullable: true })
  createdBy: string | null;

  /** Provenance: migration-safe identifier for this rule definition */
  @Column({ name: 'provenance_hash', type: 'varchar', nullable: true })
  provenanceHash: string | null;
}
