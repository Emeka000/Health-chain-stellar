import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReadinessChecklistEntity } from './entities/readiness-checklist.entity';
import { ReadinessItemEntity } from './entities/readiness-item.entity';
import { ReadinessController } from './readiness.controller';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReadinessChecklistEntity, ReadinessItemEntity]),
  ],
  controllers: [ReadinessController],
  providers: [ReadinessService],
  exports: [ReadinessService],
})
export class ReadinessModule {}
