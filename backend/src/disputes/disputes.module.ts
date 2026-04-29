import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DisputeEntity } from './entities/dispute.entity';
import { DisputeNoteEntity } from './entities/dispute-note.entity';
import { DisputesService } from './disputes.service';
import { DisputesController } from './disputes.controller';
import { SorobanModule } from '../soroban/soroban.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReconciliationLogEntity } from '../soroban/entities/reconciliation-log.entity';
import { DisputeTimeoutScanner } from './dispute-timeout.scanner';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DisputeEntity,
      DisputeNoteEntity,
      ReconciliationLogEntity,
    ]),
    SorobanModule,
    NotificationsModule,
  ],
  controllers: [DisputesController],
  providers: [DisputesService, DisputeTimeoutScanner],
  exports: [DisputesService],
})
export class DisputesModule {}
