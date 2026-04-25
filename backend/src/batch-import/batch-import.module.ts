import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InventoryEntity } from '../inventory/entities/inventory.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { RiderEntity } from '../riders/entities/rider.entity';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { FileMetadataModule } from '../file-metadata/file-metadata.module';

import { ImportBatchEntity } from './entities/import-batch.entity';
import { ImportStagingRowEntity } from './entities/import-staging-row.entity';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportValidationService } from './import-validation.service';

@Module({
  imports: [
    MulterModule.register({ storage: undefined }), // memory storage (buffer)
    TypeOrmModule.forFeature([
      ImportBatchEntity,
      ImportStagingRowEntity,
      OrganizationEntity,
      RiderEntity,
      InventoryEntity,
    ]),
    UserActivityModule,
    FileMetadataModule,
  ],
  controllers: [ImportController],
  providers: [ImportService, ImportValidationService],
})
export class BatchImportModule {}
