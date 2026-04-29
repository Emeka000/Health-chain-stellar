import {
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    IsUUID,
    Max,
    Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EscrowRiskProfile, EscrowVoteDecision } from '../enums/escrow-governance.enum';

export class CreateEscrowProposalDto {
    @ApiProperty({ description: 'Off-chain payment / order ID' })
    @IsString()
    @IsNotEmpty()
    paymentId: string;

    @ApiPropertyOptional({ description: 'On-chain Soroban escrow contract ID' })
    @IsOptional()
    @IsString()
    onChainEscrowId?: string;

    @ApiProperty({ description: 'Payment amount in stroops (as string to avoid JS precision loss)' })
    @IsString()
    @IsNotEmpty()
    amount: string;

    @ApiPropertyOptional({ enum: EscrowRiskProfile, description: 'Override risk profile (auto-detected if omitted)' })
    @IsOptional()
    @IsEnum(EscrowRiskProfile)
    riskProfile?: EscrowRiskProfile;

    @ApiPropertyOptional({ description: 'Arbitrary metadata (proof bundle ID, order ID, etc.)' })
    @IsOptional()
    metadata?: Record<string, unknown>;

    @ApiPropertyOptional({ description: 'Execution payload to run once threshold is reached' })
    @IsOptional()
    executionPayload?: Record<string, unknown>;
}

export class CastVoteDto {
    @ApiProperty({ enum: EscrowVoteDecision })
    @IsEnum(EscrowVoteDecision)
    decision: EscrowVoteDecision;

    @ApiPropertyOptional({ description: 'Optional justification comment' })
    @IsOptional()
    @IsString()
    comment?: string;
}

export class AddSignerDto {
    @ApiProperty({ description: 'User ID of the new signer' })
    @IsString()
    @IsNotEmpty()
    userId: string;

    @ApiProperty({ description: 'Human-readable label for this signer' })
    @IsString()
    @IsNotEmpty()
    label: string;
}

export class RevokeSignerDto {
    @ApiProperty({ description: 'Reason for revocation' })
    @IsString()
    @IsNotEmpty()
    reason: string;
}

export class SuspendSignerDto {
    @ApiProperty({ description: 'Reason for suspension' })
    @IsString()
    @IsNotEmpty()
    reason: string;
}

export class CancelProposalDto {
    @ApiProperty({ description: 'Reason for cancellation' })
    @IsString()
    @IsNotEmpty()
    reason: string;
}

export class CreateThresholdPolicyDto {
    @ApiProperty({ description: 'Human-readable policy name' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiPropertyOptional({ description: 'Minimum amount in stroops (inclusive). Omit for no lower bound.' })
    @IsOptional()
    @IsString()
    minAmount?: string;

    @ApiPropertyOptional({ description: 'Maximum amount in stroops (exclusive). Omit for no upper bound.' })
    @IsOptional()
    @IsString()
    maxAmount?: string;

    @ApiProperty({ enum: EscrowRiskProfile })
    @IsEnum(EscrowRiskProfile)
    riskProfile: EscrowRiskProfile;

    @ApiProperty({ description: 'Number of approvals required', minimum: 1, maximum: 10 })
    @IsInt()
    @Min(1)
    @Max(10)
    requiredApprovals: number;

    @ApiPropertyOptional({ description: 'Proposal TTL in hours before auto-expiry', default: 24 })
    @IsOptional()
    @IsInt()
    @IsPositive()
    expiryHours?: number;
}

export class EmergencySuspendDto {
    @ApiProperty({ description: 'Reason for emergency suspension' })
    @IsString()
    @IsNotEmpty()
    reason: string;
}
