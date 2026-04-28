import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { CustodyActor, CustodyHandoffStatus } from '../enums/custody.enum';

@Entity('custody_handoffs')
@Index(['bloodUnitId'])
@Index(['orderId'])
@Index(['status'])
export class CustodyHandoffEntity extends BaseEntity {
  @Column({ name: 'blood_unit_id', type: 'varchar' })
  bloodUnitId: string;

  @Column({ name: 'order_id', type: 'varchar', nullable: true })
  orderId: string | null;

  @Column({ name: 'from_actor_id', type: 'varchar' })
  fromActorId: string;

  @Column({ name: 'from_actor_type', type: 'enum', enum: CustodyActor })
  fromActorType: CustodyActor;

  @Column({ name: 'to_actor_id', type: 'varchar' })
  toActorId: string;

  @Column({ name: 'to_actor_type', type: 'enum', enum: CustodyActor })
  toActorType: CustodyActor;

  @Column({ name: 'status', type: 'enum', enum: CustodyHandoffStatus, default: CustodyHandoffStatus.PENDING })
  status: CustodyHandoffStatus;

  @Column({ name: 'latitude', type: 'float', nullable: true })
  latitude: number | null;

  @Column({ name: 'longitude', type: 'float', nullable: true })
  longitude: number | null;

  @Column({ name: 'proof_reference', type: 'varchar', nullable: true })
  proofReference: string | null;

  @Column({ name: 'contract_event_id', type: 'varchar', nullable: true })
  contractEventId: string | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;
}
