import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { UserEntity } from '../users/entities/user.entity';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { DisputeEntity } from '../disputes/entities/dispute.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';
import { BloodRequestsModule } from '../blood-requests/blood-requests.module';
import { UsersModule } from '../users/users.module';

import { ReportViewMetadataEntity } from './entities/report-view-metadata.entity';
import { GeneratedReportEntity } from './entities/generated-report.entity';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';
import { ReportViewRefreshService } from './report-view-refresh.service';
import { ReportGeneratorService } from './services/report-generator.service';
import { ReportExportService } from './services/report-export.service';
import { ReportExportProcessor } from './processors/report-export.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      BloodUnit,
      OrderEntity,
      DisputeEntity,
      OrganizationEntity,
      BloodRequestEntity,
      ReportViewMetadataEntity,
      GeneratedReportEntity,
    ]),
    BullModule.registerQueue({
      name: 'report-export',
    }),
    forwardRef(() => BloodRequestsModule),
    UsersModule,
  ],
  controllers: [ReportingController],
  providers: [
    ReportingService,
    ReportViewRefreshService,
    ReportGeneratorService,
    ReportExportService,
    ReportExportProcessor,
  ],
  exports: [
    ReportingService,
    ReportViewRefreshService,
    ReportGeneratorService,
    ReportExportService,
  ],
})
export class ReportingModule {}
