import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HospitalEntity } from '../hospitals/entities/hospital.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { RedisModule } from '../redis/redis.module';
import { RiderEntity } from '../riders/entities/rider.entity';
import { UserEntity } from '../users/entities/user.entity';

import { ActorRegistryService } from './actor-registry.service';

@Module({
  imports: [
    RedisModule,
    TypeOrmModule.forFeature([
      OrganizationEntity,
      HospitalEntity,
      RiderEntity,
      UserEntity,
    ]),
  ],
  providers: [ActorRegistryService],
  exports: [ActorRegistryService],
})
export class RegistryModule {}
