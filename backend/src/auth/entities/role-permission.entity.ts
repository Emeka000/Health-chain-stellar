import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Permission } from '../enums/permission.enum';
import { RoleEntity } from './role.entity';

@Entity('role_permissions')
export class RolePermissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RoleEntity, (role) => role.permissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'role_id' })
  role: RoleEntity;

  @Column({
    type: 'varchar',
    length: 100,
    name: 'permission',
  })
  permission: Permission;
}
