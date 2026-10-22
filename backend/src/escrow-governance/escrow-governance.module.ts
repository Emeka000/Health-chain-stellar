import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../common/audit/audit-log.module';

import { EscrowProposalEntity } from './entities/escrow-proposal.entity';
import { EscrowSignerEntity } from './entities/escrow-signer.entity';
import { EscrowThresholdPolicyEntity } from './entities/escrow-threshold-policy.entity';
import { EscrowVoteEntity } from './entities/escrow-vote.entity';
import { EscrowGovernanceController } from './escrow-governance.controller';
import { EscrowGovernanceListener } from './escrow-governance.listener';
import { EscrowGovernanceService } from './escrow-governance.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            EscrowProposalEntity,
            EscrowVoteEntity,
            EscrowSignerEntity,
            EscrowThresholdPolicyEntity,
        ]),
        AuditLogModule,
    ],
    providers: [EscrowGovernanceService, EscrowGovernanceListener],
    controllers: [EscrowGovernanceController],
    exports: [EscrowGovernanceService],
})
export class EscrowGovernanceModule { }
