import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IncidentReviewsModule } from '../incident-reviews/incident-reviews.module';

import { DeviationIncidentListener } from './deviation-incident.listener';
import { PlannedRouteEntity } from './entities/planned-route.entity';
import { RouteDeviationIncidentEntity } from './entities/route-deviation-incident.entity';
import { RouteDeviationController } from './route-deviation.controller';
import { RouteDeviationGateway } from './route-deviation.gateway';
import { RouteDeviationService } from './route-deviation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlannedRouteEntity,
      RouteDeviationIncidentEntity,
    ]),
    IncidentReviewsModule,
  ],
  controllers: [RouteDeviationController],
  providers: [
    RouteDeviationService,
    RouteDeviationGateway,
    DeviationIncidentListener,
  ],
  exports: [RouteDeviationService],
})
export class RouteDeviationModule {}
