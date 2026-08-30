import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CustodyModule } from '../custody/custody.module';
import { FileMetadataModule } from '../file-metadata/file-metadata.module';
import { SorobanModule } from '../soroban/soroban.module';

import { DeliveryProofController } from './delivery-proof.controller';
import { DeliveryProofService } from './delivery-proof.service';
import { DeliveryProofEntity } from './entities/delivery-proof.entity';
import { UploadValidationService } from './upload-validation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeliveryProofEntity]),
    ConfigModule,
    SorobanModule,
    CustodyModule,
    FileMetadataModule,
  ],
  controllers: [DeliveryProofController],
  providers: [DeliveryProofService, UploadValidationService],
  exports: [DeliveryProofService],
})
export class DeliveryProofModule {}
