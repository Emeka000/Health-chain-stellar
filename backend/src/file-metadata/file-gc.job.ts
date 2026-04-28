import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FileMetadataService } from './file-metadata.service';

@Injectable()
export class FileGcJob {
  private readonly logger = new Logger(FileGcJob.name);

  constructor(private readonly fileMetadataService: FileMetadataService) {}

  /** Runs every hour; deletes orphaned/superseded files past the 24-hour retention window. */
  @Cron(CronExpression.EVERY_HOUR)
  async runGc(): Promise<void> {
    const candidates = await this.fileMetadataService.findGcCandidates();
    if (candidates.length === 0) return;

    this.logger.log(`GC: found ${candidates.length} file(s) to clean up`);
    for (const file of candidates) {
      await this.fileMetadataService.delete(file.id);
      this.logger.debug(`GC: deleted ${file.storagePath} (${file.status})`);
    }
    this.logger.log(`GC: cleaned up ${candidates.length} file(s)`);
  }
}
