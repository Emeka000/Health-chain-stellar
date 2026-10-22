import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Urgency of a blood request as persisted on the entity.
 *
 * NOTE: This is the source of truth for the set of urgencies the domain
 * supports. The queue-side enum (`QueueRequestUrgency`) and its priority /
 * SLA maps must stay in sync with these values.
 */
export enum RequestUrgency {
  CRITICAL = 'CRITICAL',
  URGENT = 'URGENT',
  ROUTINE = 'ROUTINE',
  SCHEDULED = 'SCHEDULED',
}

@Entity('blood_requests')
export class BloodRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'enum', enum: RequestUrgency })
  urgency: RequestUrgency;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
