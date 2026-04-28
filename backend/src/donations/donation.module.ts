import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConsentModule } from '../consent/consent.module';
import { DonationEntity } from './entities/donation.entity';
import { PledgeEntity } from './entities/pledge.entity';
import { DonationService } from './services/donation.service';
import { PledgeService } from './services/pledge.service';
import { DonationController } from './controllers/donation.controller';
import { PledgeController } from './controllers/pledge.controller';
import { SorobanModule } from '../soroban/soroban.module';
import { UserActivityModule } from '../user-activity/user-activity.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DonationEntity, PledgeEntity]),
    SorobanModule,
    UserActivityModule,
    ConsentModule,
  ],
  providers: [DonationService, PledgeService],
  controllers: [DonationController, PledgeController],
  exports: [DonationService, PledgeService],
})
export class DonationModule {}
