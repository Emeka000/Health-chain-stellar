import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { DisputesService } from './disputes.service';

@Injectable()
export class DisputeTimeoutScanner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DisputeTimeoutScanner.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly disputesService: DisputesService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.disputesService.scanAndProcessExpiredDisputes().catch((error: Error) => {
        this.logger.error(`Dispute timeout scan failed: ${error.message}`);
      });
    }, 30_000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
