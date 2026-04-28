import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
  BaseEntity,
} from 'typeorm';

import { UserRole } from '../../auth/enums/user-role.enum';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';

import { TwoFactorAuthEntity } from './two-factor-auth.entity';

@Entity('users')
@Index('IDX_USERS_EMAIL', ['email'], { unique: true })
@Index('IDX_USERS_ORGANIZATION_ID', ['organizationId'])
@Index('IDX_USERS_ROLE', ['role'])
@Index('IDX_USERS_REGION', ['region'])
@Index('IDX_USERS_CREATED_AT', ['createdAt'])
export class UserEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'first_name', type: 'varchar', length: 100, nullable: true })
  firstName?: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  lastName?: string | null;

  /** Legacy single-role field kept for backward compatibility with auth service */
  @Column({ default: 'donor' })
  role: string;

  /** Multi-role support */
  @Column({ type: 'simple-array', nullable: true })
  roles?: UserRole[] | null;

  /** Flexible profile data (blood type, preferences, etc.) */
  @Column({ type: 'jsonb', nullable: true })
  profile?: Record<string, unknown> | null;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  region: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 40, nullable: true })
  phoneNumber?: string | null;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null;

  @Column({ name: 'password_hash', nullable: true })
  passwordHash?: string;

  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failedLoginAttempts: number;

  @Column({ name: 'locked_until', type: 'timestamp', nullable: true })
  lockedUntil?: Date | null;

  @Column({ name: 'password_history', type: 'simple-json', nullable: true })
  passwordHistory?: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified: boolean;

  @Column({ name: 'anonymised', type: 'boolean', default: false })
  anonymised: boolean;

  @ManyToOne(() => OrganizationEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity | null;

  @OneToOne(() => TwoFactorAuthEntity, (tfa) => tfa.user, {
    nullable: true,
    cascade: true,
  })
  twoFactorAuth?: TwoFactorAuthEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}
