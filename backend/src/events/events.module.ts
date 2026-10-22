import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { DeadLetterEventEntity } from './entities/dead-letter-event.entity';
import { DeadLetterService } from './dead-letter.service';
import { DeadLetterController } from './dead-letter.controller';
import { EventSchemaRegistryService } from './event-schema-registry.service';
import { CanonicalEventEmitterService } from './canonical-event-emitter.service';
import { EventSystemInitializerService } from './event-system-initializer.service';
import { OutboxController } from './outbox.controller';
import { OutboxDeadLetterEntity } from './outbox-dead-letter.entity';
import { OutboxEventEntity } from './outbox-event.entity';
import { OutboxService } from './outbox.service';

/**
 * Events Module
 * 
 * Provides canonical event infrastructure including:
 * - Event envelope standardization
 * - Schema validation
 * - Dead-letter storage and replay
 * - Event emission with validation
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeadLetterEventEntity,
      OutboxEventEntity,
      OutboxDeadLetterEntity,
    ]),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 50,
      verboseMemoryLeak: true,
    }),
  ],
  controllers: [DeadLetterController, OutboxController],
  providers: [
    DeadLetterService,
    EventSchemaRegistryService,
    CanonicalEventEmitterService,
    EventSystemInitializerService,
    OutboxService,
  ],
  exports: [
    DeadLetterService,
    EventSchemaRegistryService,
    CanonicalEventEmitterService,
    OutboxService,
  ],
})
export class EventsModule { }
