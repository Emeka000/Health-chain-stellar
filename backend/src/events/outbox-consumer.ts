import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { OutboxService } from './outbox.service';

/**
 * Legacy BullMQ consumer kept for backward compatibility.
 * New delivery is handled by OutboxProducer (lease-based polling).
 */
@Injectable()
export class OutboxConsumer {
  private readonly logger = new Logger(OutboxConsumer.name);

  constructor(
    private readonly outboxService: OutboxService,
    private readonly eventEmitter: EventEmitter2,
  ) {}
}
