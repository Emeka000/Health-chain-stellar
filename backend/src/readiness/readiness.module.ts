import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReadinessChecklistEntity } from './entities/readiness-checklist.entity';
import { ReadinessItemEntity } from './entities/readiness-item.entity';
import { ReadinessDependencyEntity } from './entities/readiness-dependency.entity';
import { ReadinessController } from './readiness.controller';
import { ReadinessService } from './readiness.service';
import { ReadinessGraphService } from './services/readiness-graph.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReadinessChecklistEntity,
      ReadinessItemEntity,
      ReadinessDependencyEntity,
    ]),
  ],
  controllers: [ReadinessController],
  providers: [ReadinessService, ReadinessGraphService],
  exports: [ReadinessService, ReadinessGraphService],
})
export class ReadinessModule {}
