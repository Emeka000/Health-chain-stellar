import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { SoftDeleteRepository } from '../common/repositories/soft-delete.repository';

import { OrganizationEntity } from './entities/organization.entity';

@Injectable()
export class OrganizationRepository extends SoftDeleteRepository<OrganizationEntity> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(OrganizationEntity, dataSource.createEntityManager());
  }

  findByName(name: string): Promise<OrganizationEntity | null> {
    return this.findOne({
      where: { name, deletedAt: null },
    });
  }

  findByRegistrationNumber(
    registrationNumber: string,
  ): Promise<OrganizationEntity | null> {
    return this.findOne({
      where: { registrationNumber, deletedAt: null },
    });
  }

  findActive(): Promise<OrganizationEntity[]> {
    return this.createActiveQueryBuilder('org')
      .andWhere('org.is_active = true')
      .getMany();
  }

  findByType(type: string): Promise<OrganizationEntity[]> {
    return this.createActiveQueryBuilder('org')
      .andWhere('org.type = :type', { type })
      .getMany();
  }
}
