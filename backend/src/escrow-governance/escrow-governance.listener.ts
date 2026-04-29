import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { EscrowProposalApprovedEvent, EscrowProposalExecutedEvent } from './escrow-governance.service';

/**
 * Listens for escrow governance domain events and triggers downstream actions.
 *
 * When a proposal reaches its approval threshold the listener can
 * automatically initiate the on-chain escrow release via SorobanService.
 * The actual Soroban call is intentionally left as a hook so callers can
 * inject the appropriate service without creating a circular dependency.
 */
@Injectable()
export class EscrowGovernanceListener {
    private readonly logger = new Logger(EscrowGovernanceListener.name);

    @OnEvent('escrow.proposal.approved')
    handleProposalApproved(event: EscrowProposalApprovedEvent): void {
        const { proposal } = event;
        this.logger.log(
            `[EscrowGovernance] Proposal ${proposal.id} approved — ` +
            `paymentId=${proposal.paymentId} amount=${proposal.amount}. ` +
            `Ready for on-chain execution.`,
        );
        // Downstream: emit to payment service or call SorobanService.submitTransaction
        // with the executionPayload stored on the proposal.
    }

    @OnEvent('escrow.proposal.executed')
    handleProposalExecuted(event: EscrowProposalExecutedEvent): void {
        this.logger.log(
            `[EscrowGovernance] Proposal ${event.proposal.id} executed on-chain — txHash=${event.txHash}`,
        );
    }
}
