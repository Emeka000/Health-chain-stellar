import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DeliveryProofModule } from '../delivery-proof/delivery-proof.module';
import { ProofBundleEntity } from './entities/proof-bundle.entity';
import { ProofBundleController } from './proof-bundle.controller';
import { ProofBundleService } from './proof-bundle.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProofBundleEntity]),
    DeliveryProofModule,
  ],
  controllers: [ProofBundleController],
  providers: [ProofBundleService],
  exports: [ProofBundleService],
})
export class ProofBundleModule {}
