import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ReadinessItemKey } from '../enums/readiness.enum';

@Entity('readiness_dependencies')
@Index('idx_rd_keys', ['parentItemKey', 'dependsOnItemKey'], { unique: true })
export class ReadinessDependencyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The item that is blocked until the dependency is met */
  @Column({ name: 'parent_item_key', type: 'enum', enum: ReadinessItemKey })
  parentItemKey: ReadinessItemKey;

  /** The prerequisite item */
  @Column({ name: 'depends_on_item_key', type: 'enum', enum: ReadinessItemKey })
  dependsOnItemKey: ReadinessItemKey;

  /** 
   * Optional SQL-like or JSON expression for conditional dependencies.
   * If null, the dependency is always required.
   */
  @Column({ name: 'condition_expression', type: 'text', nullable: true })
  conditionExpression: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
