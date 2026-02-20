import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RolePermissionEntity } from './role-permission.entity';

/**
 * Persists roles (ADMIN, HOSPITAL, RIDER, DONOR, VENDOR).
 * Role-to-permission mappings are stored separately in role_permissions so
 * they can be updated at runtime without a redeployment.
 */
@Entity('roles')
export class RoleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 50 })
  name: string;

  @Column({ nullable: true, type: 'varchar', length: 255 })
  description: string | null;

  @OneToMany(() => RolePermissionEntity, (rp) => rp.role, { cascade: true })
  rolePermissions: RolePermissionEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
