export enum EscrowProposalStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    EXPIRED = 'EXPIRED',
    CANCELLED = 'CANCELLED',
    EXECUTED = 'EXECUTED',
    SUSPENDED = 'SUSPENDED',
}

export enum EscrowRiskProfile {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL',
}

export enum EscrowVoteDecision {
    APPROVE = 'APPROVE',
    REJECT = 'REJECT',
}

export enum EscrowSignerStatus {
    ACTIVE = 'ACTIVE',
    REVOKED = 'REVOKED',
    SUSPENDED = 'SUSPENDED',
}
