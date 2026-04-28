import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConsentService } from './consent.service';
import { ConsentRecordEntity } from './entities/consent-record.entity';
import { ConsentTermEntity } from './entities/consent-term.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ConsentTermEntity, ConsentRecordEntity])],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
