import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { OutboxEventEntity } from './outbox-event.entity';
import { OutboxService } from './outbox.service';
import { OutboxProducer } from './outbox-producer';
import { OutboxConsumer } from './outbox-consumer';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEventEntity]),
    BullModule.registerQueue({
      name: 'outbox-events',
    }),
    EventEmitterModule.forRoot(),
  ],
  providers: [OutboxService, OutboxProducer, OutboxConsumer],
  exports: [OutboxService],
})
export class EventsModule {}
