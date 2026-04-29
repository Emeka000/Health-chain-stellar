import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { DeadLetterEventEntity } from './entities/dead-letter-event.entity';
import { DeadLetterService } from './dead-letter.service';
import { DeadLetterController } from './dead-letter.controller';
import { EventSchemaRegistryService } from './event-schema-registry.service';
import { CanonicalEventEmitterService } from './canonical-event-emitter.service';
import { EventSystemInitializerService } from './event-system-initializer.service';

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
    TypeOrmModule.forFeature([DeadLetterEventEntity]),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 50,
      verboseMemoryLeak: true,
    }),
  ],
  controllers: [DeadLetterController],
  providers: [
    DeadLetterService,
    EventSchemaRegistryService,
    CanonicalEventEmitterService,
    EventSystemInitializerService,
  ],
  exports: [
    DeadLetterService,
    EventSchemaRegistryService,
    CanonicalEventEmitterService,
  ],
})
export class EventsModule { }
