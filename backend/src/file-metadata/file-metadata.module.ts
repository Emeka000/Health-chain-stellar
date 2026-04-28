import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileMetadataAuditLogEntity } from './entities/file-metadata-audit-log.entity';
import { FileMetadataEntity } from './entities/file-metadata.entity';
import { FileGcJob } from './file-gc.job';
import { FileMetadataService } from './file-metadata.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([FileMetadataEntity, FileMetadataAuditLogEntity]),
  ],
  providers: [FileMetadataService, FileGcJob],
  exports: [FileMetadataService],
})
export class FileMetadataModule {}
