import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('blockchain_events')
@Index(['eventType', 'blockchainTimestamp'])
@Index(['transactionHash'], { unique: true })
export class BlockchainEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'varchar', length: 255 })
  transactionHash: string;

  @Column({ type: 'jsonb' })
  eventData: Record<string, any>;

  @Column({ type: 'timestamp' })
  blockchainTimestamp: Date;

  @CreateDateColumn()
  indexedAt: Date;

  @Column({ type: 'boolean', default: false })
  processed: boolean;
}
