import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RegionEntity } from './entities/region.entity';
import { RegionScopeGuard } from './guards/region-scope.guard';
import { RegionsController } from './regions.controller';
import { RegionsService } from './regions.service';

@Module({
  imports: [TypeOrmModule.forFeature([RegionEntity])],
  controllers: [RegionsController],
  providers: [RegionsService, RegionScopeGuard],
  exports: [RegionsService, RegionScopeGuard],
})
export class RegionsModule {}
