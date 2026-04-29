import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import {
  InFlightConflictPolicy,
  OrgLifecycleStatus,
  RestrictionLevel,
  VerificationChangeReason,
} from '../enums/org-lifecycle.enum';

/**
 * Append-only audit log for every verification lifecycle transition.
 * Never updated — provides full provenance for compliance and dispute resolution.
 */
@Entity('org_verification_history')
@Index(['organizationId'])
@Index(['organizationId', 'toStatus'])
export class OrgVerificationHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({
    name: 'from_status',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  fromStatus: OrgLifecycleStatus | null;

  @Column({ name: 'to_status', type: 'varchar', length: 40 })
  toStatus: OrgLifecycleStatus;

  @Column({ name: 'actor_id', type: 'varchar' })
  actorId: string;

  @Column({ name: 'reason', type: 'varchar', length: 60 })
  reason: VerificationChangeReason;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  /** Snapshot of in-flight order IDs at the time of the transition */
  @Column({ name: 'in_flight_order_ids', type: 'jsonb', nullable: true })
  inFlightOrderIds: string[] | null;

  /** Policy applied to in-flight operations */
  @Column({
    name: 'conflict_policy',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  conflictPolicy: InFlightConflictPolicy | null;

  /** Restriction level active at the time of this transition */
  @Column({
    name: 'restriction_level',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  restrictionLevel: RestrictionLevel | null;

  /** On-chain tx hash if the transition was propagated to Soroban */
  @Column({ name: 'blockchain_tx_hash', type: 'varchar', length: 128, nullable: true })
  blockchainTxHash: string | null;

  @CreateDateColumn({ name: 'transitioned_at' })
  transitionedAt: Date;
}
