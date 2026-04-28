import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum DispatchStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  IN_TRANSIT = 'IN_TRANSIT',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export const ALLOWED_TRANSITIONS: Record<DispatchStatus, DispatchStatus[]> = {
  [DispatchStatus.PENDING]: [DispatchStatus.ASSIGNED, DispatchStatus.CANCELLED],
  [DispatchStatus.ASSIGNED]: [DispatchStatus.IN_TRANSIT, DispatchStatus.CANCELLED],
  [DispatchStatus.IN_TRANSIT]: [DispatchStatus.COMPLETED, DispatchStatus.CANCELLED],
  [DispatchStatus.COMPLETED]: [],
  [DispatchStatus.CANCELLED]: [],
};

@Entity('dispatch_records')
export class DispatchRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'rider_id', nullable: true, type: 'varchar' })
  riderId: string | null;

  @Column({ type: 'simple-enum', enum: DispatchStatus, default: DispatchStatus.PENDING })
  status: DispatchStatus;

  @Column({ name: 'cancel_reason', nullable: true, type: 'text' })
  cancelReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => DispatchStatusHistory, (h) => h.dispatch, { cascade: true })
  history: DispatchStatusHistory[];
}

@Entity('dispatch_status_history')
export class DispatchStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dispatch_id' })
  dispatchId: string;

  @Column({ type: 'simple-enum', enum: DispatchStatus })
  status: DispatchStatus;

  @Column({ nullable: true, type: 'text' })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => DispatchRecord, (d) => d.history)
  @JoinColumn({ name: 'dispatch_id' })
  dispatch: DispatchRecord;
}
