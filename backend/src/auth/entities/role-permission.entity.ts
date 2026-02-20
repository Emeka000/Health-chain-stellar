import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { RoleEntity } from './role.entity';

/**
 * Append-friendly join table that binds a role to a single permission string.
 * Rows can be inserted / deleted at runtime to update a role's permissions
 * without touching application code or triggering a redeployment.
 */
@Entity('role_permissions')
@Index('idx_role_permissions_role_id', ['roleId'])
@Index('idx_role_permissions_unique', ['roleId', 'permission'], { unique: true })
export class RolePermissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'role_id' })
  roleId: string;

  @Column({ length: 100 })
  permission: string;

  @ManyToOne(() => RoleEntity, (role) => role.rolePermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'role_id' })
  role: RoleEntity;
}
