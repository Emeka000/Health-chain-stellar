import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OutboxConsumer } from './outbox-consumer';
import { OutboxController } from './outbox.controller';
import { OutboxDeadLetterEntity } from './outbox-dead-letter.entity';
import { OutboxEventEntity } from './outbox-event.entity';
import { OutboxProducer } from './outbox-producer';
import { OutboxService } from './outbox.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEventEntity, OutboxDeadLetterEntity]),
  ],
  controllers: [OutboxController],
  providers: [OutboxService, OutboxProducer, OutboxConsumer],
  exports: [OutboxService],
})
export class EventsModule {}
