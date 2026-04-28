import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from '../orders/entities/order.entity';
import { SlaRecordEntity } from './entities/sla-record.entity';
import { SlaController } from './sla.controller';
import { SlaEventListener } from './sla-event.listener';
import { SlaService } from './sla.service';

@Module({
  imports: [TypeOrmModule.forFeature([SlaRecordEntity, OrderEntity])],
  controllers: [SlaController],
  providers: [SlaService, SlaEventListener],
  exports: [SlaService],
})
export class SlaModule {}
