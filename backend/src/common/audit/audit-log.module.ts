import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditChainCheckpointEntity, AuditChainEntryEntity } from './audit-chain.entity';
import { AuditChainService } from './audit-chain.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLogEntity } from './audit-log.entity';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditLogService } from './audit-log.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      AuditLogEntity,
      AuditChainEntryEntity,
      AuditChainCheckpointEntity,
    ]),
  ],
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditLogInterceptor, AuditChainService],
  exports: [AuditLogService, AuditLogInterceptor, AuditChainService],
})
export class AuditLogModule {}
