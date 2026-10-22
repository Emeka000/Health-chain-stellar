import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { EscalationService } from './escalation.service';

@Injectable()
export class EscalationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EscalationSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly escalationService: EscalationService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.escalationService.processTimeoutEscalations().catch((error: Error) => {
        this.logger.error(`Escalation scheduler failed: ${error.message}`);
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
