import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MediaProcessingService } from './media-processing.service';
import { MediaProcessingController } from './media-processing.controller';

@Module({
  imports: [ConfigModule],
  controllers: [MediaProcessingController],
  providers: [MediaProcessingService],
  exports: [MediaProcessingService],
})
export class MediaProcessingModule {}
