import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { OrgLifecycleStatus, RestrictionLevel } from '../enums/org-lifecycle.enum';

export enum GracePeriodState {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

/**
 * Tracks an active grace period for a suspended organization.
 * Restriction level escalates in stages as the deadline approaches.
 */
@Entity('org_grace_periods')
@Index(['organizationId', 'state'])
@Index(['expiresAt'])
export class OrgGracePeriodEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Status the org will transition to when the grace period expires */
  @Column({ name: 'target_status', type: 'varchar', length: 40 })
  targetStatus: OrgLifecycleStatus;

  @Column({
    name: 'state',
    type: 'varchar',
    length: 20,
    default: GracePeriodState.ACTIVE,
  })
  state: GracePeriodState;

  /** Current staged restriction level */
  @Column({
    name: 'restriction_level',
    type: 'varchar',
    length: 30,
    default: RestrictionLevel.NEW_ORDERS_BLOCKED,
  })
  restrictionLevel: RestrictionLevel;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** When the restriction escalated to FULLY_RESTRICTED */
  @Column({ name: 'fully_restricted_at', type: 'timestamptz', nullable: true })
  fullyRestrictedAt: Date | null;

  @Column({ name: 'actor_id', type: 'varchar' })
  actorId: string;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
