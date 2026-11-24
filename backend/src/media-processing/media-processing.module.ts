import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FileMetadataModule } from '../file-metadata/file-metadata.module';
import { MediaProcessingService } from './media-processing.service';
import { MediaProcessingController } from './media-processing.controller';
import { ClamAvScanner } from './malware-scanner';

@Module({
  imports: [ConfigModule, FileMetadataModule],
  controllers: [MediaProcessingController],
  providers: [MediaProcessingService, ClamAvScanner],
  exports: [MediaProcessingService],
})
export class MediaProcessingModule {}
