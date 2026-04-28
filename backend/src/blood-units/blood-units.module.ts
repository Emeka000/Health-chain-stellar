import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationsModule } from '../notifications/notifications.module';
import { OrderEntity } from '../orders/entities/order.entity';
import { BlockchainEvent } from '../soroban/entities/blockchain-event.entity';
import { BloodUnitTrail } from '../soroban/entities/blood-unit-trail.entity';
import { SorobanModule } from '../soroban/soroban.module';
import { DonorEligibilityModule } from '../donor-eligibility/donor-eligibility.module';
import { PolicyCenterModule } from '../policy-center/policy-center.module';

import { BloodInventoryQueryService } from './blood-inventory-query.service';
import { BloodStatusService } from './blood-status.service';
import { BloodUnitsController } from './blood-units.controller';
import { BloodUnitsService } from './blood-units.service';
import { QrVerificationService } from './qr-verification.service';
import { QuarantineService } from './services/quarantine.service';
import { BloodUnit, BloodUnitEntity } from './entities/blood-unit.entity';
import { BloodStatusHistory } from './entities/blood-status-history.entity';
import { QrVerificationLogEntity } from './entities/qr-verification-log.entity';
import { UnitDispositionRecord } from './entities/unit-disposition.entity';
import { QuarantineCase } from './entities/quarantine-case.entity';
import { DispositionController } from './controllers/disposition.controller';
import { QuarantineController } from './controllers/quarantine.controller';
import { DispositionService } from './services/disposition.service';
import { TransferRecord } from './entities/transfer-record.entity';
import { BloodUnitBatchService } from './batch/blood-unit-batch.service';


@Module({
  imports: [
    MulterModule.register({ storage: undefined }), // memory storage
    TypeOrmModule.forFeature([
      BloodUnitTrail,
      BloodUnitEntity,
      BloodUnit,
      BloodStatusHistory,
      BlockchainEvent,
      QrVerificationLogEntity,
      OrderEntity,
      UnitDispositionRecord,
      QuarantineCase,
      TransferRecord,
    ]),

    SorobanModule,
    NotificationsModule,
    DonorEligibilityModule,
    PolicyCenterModule,
  ],
  controllers: [BloodUnitsController, DispositionController, QuarantineController],
  providers: [
    BloodUnitsService,
    BloodStatusService,
    BloodInventoryQueryService,
    QrVerificationService,
    DispositionService,
    QuarantineService,
    BloodUnitBatchService,
  ],
  exports: [
    BloodUnitsService,
    BloodStatusService,
    BloodInventoryQueryService,
    DispositionService,
    QuarantineService,
  ],
})
export class BloodUnitsModule {}
