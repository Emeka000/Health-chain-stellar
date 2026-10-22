import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { IncidentReviewsModule } from '../incident-reviews/incident-reviews.module';
import { RedisModule } from '../redis/redis.module';

import { DeviationIncidentListener } from './deviation-incident.listener';
import { PlannedRouteEntity } from './entities/planned-route.entity';
import { RouteDeviationIncidentEntity } from './entities/route-deviation-incident.entity';
import { RouteDeviationController } from './route-deviation.controller';
import { RouteDeviationGateway } from './route-deviation.gateway';
import { RouteDeviationService } from './route-deviation.service';
import { SeverityFeatureExtractorService } from './severity-feature-extractor.service';
import { SeverityClassifierService } from './severity-classifier.service';
import { TriageAutomationService } from './triage-automation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlannedRouteEntity,
      RouteDeviationIncidentEntity,
    ]),
    IncidentReviewsModule,
    RedisModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
  ],
  controllers: [RouteDeviationController],
  providers: [
    RouteDeviationService,
    RouteDeviationGateway,
    DeviationIncidentListener,
    SeverityFeatureExtractorService,
    SeverityClassifierService,
    TriageAutomationService,
  ],
  exports: [RouteDeviationService],
})
export class RouteDeviationModule { }
