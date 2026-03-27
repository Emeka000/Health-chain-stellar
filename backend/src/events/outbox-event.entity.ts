import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  BaseEntity,
} from 'typeorm';

export enum OutboxEventType {
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_DISPATCHED = 'ORDER_DISPATCHED',
  ORDER_IN_TRANSIT = 'ORDER_IN_TRANSIT',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ORDER_DISPUTED = 'ORDER_DISPUTED',
  ORDER_RESOLVED = 'ORDER_RESOLVED',
  INVENTORY_LOW = 'INVENTORY_LOW',
  NOTIFICATION_SENT = 'NOTIFICATION_SENT',
  BLOCKCHAIN_HOOK = 'BLOCKCHAIN_HOOK',
}

@Entity('outbox_events')
@Index('IDX_OUTBOX_PUBLISHED', ['published'])
@Index('IDX_OUTBOX_EVENT_TYPE', ['eventType'])
@Index('IDX_OUTBOX_CREATED_AT', ['createdAt'])
@Index('IDX_OUTBOX_UNPUBLISHED', ['published', 'createdAt'], {
  where: '"published" = false',
})
export class OutboxEventEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  eventType: OutboxEventType | string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 255, nullable: true })
  aggregateId?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  aggregateType?: string;

  @Column({ type: 'boolean', default: false })
  published: boolean;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt?: Date | null;

  @Column({ type: 'int', default: 0 })
  retryCount: number;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
