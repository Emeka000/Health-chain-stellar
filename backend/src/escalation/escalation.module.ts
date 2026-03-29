import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EscalationEntity } from './entities/escalation.entity';
import { EscalationService } from './escalation.service';
import { EscalationPolicyService } from './escalation-policy.service';
import { EscalationGateway } from './escalation.gateway';
import { EscalationController } from './escalation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EscalationEntity])],
  controllers: [EscalationController],
  providers: [EscalationService, EscalationPolicyService, EscalationGateway],
  exports: [EscalationService],
})
export class EscalationModule {}
