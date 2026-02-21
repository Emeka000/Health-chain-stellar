import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UserRole } from '../enums/user-role.enum';
import { RolePermissionEntity } from './role-permission.entity';

@Entity('roles')
export class RoleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
  })
  name: UserRole;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @OneToMany(() => RolePermissionEntity, (rp) => rp.role, {
    cascade: true,
    eager: true,
  })
  permissions: RolePermissionEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
