import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('blood_unit_trails')
@Index(['unitId'])
export class BloodUnitTrail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint' })
  unitId: number;

  @Column({ type: 'jsonb' })
  custodyTrail: any[];

  @Column({ type: 'jsonb' })
  temperatureLogs: any[];

  @Column({ type: 'jsonb' })
  statusHistory: any[];

  @CreateDateColumn()
  lastUpdated: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncedAt: Date;
}
