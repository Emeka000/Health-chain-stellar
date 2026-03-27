import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { FeePolicyController } from './fee-policy.controller';
import { FeePolicyService } from './fee-policy.service';
import { FeePolicyEntity } from './entities/fee-policy.entity';

@Module({
    imports: [TypeOrmModule.forFeature([FeePolicyEntity]), ConfigModule],
    controllers: [FeePolicyController],
    providers: [FeePolicyService],
    exports: [FeePolicyService],
})
export class FeePolicyModule { }
