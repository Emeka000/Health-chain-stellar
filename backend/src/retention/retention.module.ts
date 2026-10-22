import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RedisModule } from '../redis/redis.module';
import { UserActivityEntity } from '../user-activity/entities/user-activity.entity';
import { UserEntity } from '../users/entities/user.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { AuditLogModule } from '../common/audit/audit-log.module';

// Import entities from related modules for sensitive data
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { RiderEntity } from '../riders/entities/rider.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { LocationHistoryEntity } from '../location-history/entities/location-history.entity';

import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';
import { RetentionPolicyService } from './retention-policy.service';
import { RetentionExecutorService } from './retention-executor.service';
import { SensitiveDataService } from './sensitive-data.service';
import { RetentionPolicyEntity } from './entities/retention-policy.entity';
import { DataRedactionEntity } from './entities/data-redaction.entity';
import { LegalHoldEntity } from './entities/legal-hold.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserActivityEntity,
      UserEntity,
      OrderEntity,
      BloodUnit,
      RiderEntity,
      OrganizationEntity,
      LocationHistoryEntity,
      RetentionPolicyEntity,
      DataRedactionEntity,
      LegalHoldEntity,
    ]),
    RedisModule,
    AuditLogModule,
  ],
  providers: [RetentionService, RetentionPolicyService, RetentionExecutorService, SensitiveDataService],
  controllers: [RetentionController],
  exports: [RetentionService, RetentionPolicyService, RetentionExecutorService, SensitiveDataService],
})
export class RetentionModule {}
