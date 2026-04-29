import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('escalation_timeline_events')
@Index('idx_escalation_timeline_request', ['requestId'])
@Index('idx_escalation_timeline_escalation', ['escalationId'])
@Index('idx_escalation_timeline_created', ['createdAt'])
export class EscalationTimelineEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'escalation_id', type: 'uuid', nullable: true })
  escalationId: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 64 })
  requestId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType: string;

  @Column({ name: 'level', type: 'int', nullable: true })
  level: number | null;

  @Column({ name: 'target_role', type: 'varchar', length: 64, nullable: true })
  targetRole: string | null;

  @Column({ name: 'action', type: 'varchar', length: 32, nullable: true })
  action: string | null;

  @Column({ name: 'outcome', type: 'varchar', length: 32, nullable: true })
  outcome: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
