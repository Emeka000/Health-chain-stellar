import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MapsService } from './maps.service';
import { MapsController } from './maps.controller';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [ConfigModule, RedisModule],
  controllers: [MapsController],
  providers: [MapsService],
  exports: [MapsService],
})
export class MapsModule {}
