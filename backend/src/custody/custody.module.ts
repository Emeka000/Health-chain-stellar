import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SorobanModule } from '../soroban/soroban.module';
import { CustodyController } from './custody.controller';
import { CustodyHandoffEntity } from './entities/custody-handoff.entity';
import { CustodyService } from './custody.service';

@Module({
  imports: [TypeOrmModule.forFeature([CustodyHandoffEntity]), SorobanModule],
  controllers: [CustodyController],
  providers: [CustodyService],
  exports: [CustodyService],
})
export class CustodyModule {}
