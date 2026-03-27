import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  FLAT_FEE_MAX_STROOPS,
  FLAT_FEE_MIN_STROOPS,
  INSURANCE_FEE_MAX_BP,
  INSURANCE_FEE_MIN_BP,
  PAYMENT_AMOUNT_MAX_STROOPS,
  PAYMENT_AMOUNT_MIN_STROOPS,
  PLATFORM_FEE_MAX_BP,
  PLATFORM_FEE_MIN_BP,
  STELLAR_BASE_FEE_STROOPS,
  STELLAR_MAX_FEE_STROOPS,
} from './fee-policy.constants';
import { FeeRecipientType, FeePolicyStatus } from './fee-policy.entity';

// ─── Create ───────────────────────────────────────────────────────────────────

export class CreateFeePolicyDto {
  @ApiProperty({ example: 'Standard Provider Payout', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiProperty({ enum: FeeRecipientType, example: FeeRecipientType.PROVIDER })
  @IsEnum(FeeRecipientType)
  recipientType: FeeRecipientType;

  @ApiPropertyOptional({
    description: 'Platform fee in basis points (100 bp = 1 %)',
    minimum: PLATFORM_FEE_MIN_BP,
    maximum: PLATFORM_FEE_MAX_BP,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(PLATFORM_FEE_MIN_BP)
  @Max(PLATFORM_FEE_MAX_BP)
  platformFeeBp?: number = 0;

  @ApiPropertyOptional({
    description: 'Insurance processing fee in basis points',
    minimum: INSURANCE_FEE_MIN_BP,
    maximum: INSURANCE_FEE_MAX_BP,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(INSURANCE_FEE_MIN_BP)
  @Max(INSURANCE_FEE_MAX_BP)
  insuranceFeeBp?: number = 0;

  @ApiPropertyOptional({
    description: 'Fixed fee in stroops applied before percentage fees',
    minimum: FLAT_FEE_MIN_STROOPS,
    maximum: FLAT_FEE_MAX_STROOPS,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(FLAT_FEE_MIN_STROOPS)
  @Max(FLAT_FEE_MAX_STROOPS)
  flatFeeStroops?: number = 0;

  @ApiPropertyOptional({
    description: 'Stellar network fee override in stroops',
    minimum: STELLAR_BASE_FEE_STROOPS,
    maximum: STELLAR_MAX_FEE_STROOPS,
    default: STELLAR_BASE_FEE_STROOPS,
  })
  @IsOptional()
  @IsInt()
  @Min(STELLAR_BASE_FEE_STROOPS)
  @Max(STELLAR_MAX_FEE_STROOPS)
  stellarNetworkFeeStroops?: number = STELLAR_BASE_FEE_STROOPS;

  @ApiPropertyOptional({ enum: FeePolicyStatus })
  @IsOptional()
  @IsEnum(FeePolicyStatus)
  status?: FeePolicyStatus = FeePolicyStatus.DRAFT;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

// ─── Update ───────────────────────────────────────────────────────────────────

export class UpdateFeePolicyDto extends PartialType(CreateFeePolicyDto) {}

// ─── Quote / Simulate ─────────────────────────────────────────────────────────

export class QuotePaymentDto {
  @ApiProperty({
    description: 'Gross payment amount in stroops',
    minimum: PAYMENT_AMOUNT_MIN_STROOPS,
    maximum: PAYMENT_AMOUNT_MAX_STROOPS,
    example: 50_000_000,
  })
  @IsInt()
  @Min(PAYMENT_AMOUNT_MIN_STROOPS)
  @Max(PAYMENT_AMOUNT_MAX_STROOPS)
  grossAmountStroops: number;

  @ApiProperty({ description: 'UUID of the fee policy to apply' })
  @IsString()
  feePolicyId: string;
}

// ─── Response shapes ──────────────────────────────────────────────────────────

export class FeeBreakdownDto {
  grossAmountStroops: number;
  flatFeeStroops: number;
  platformFeeStroops: number;
  insuranceFeeStroops: number;
  stellarNetworkFeeStroops: number;
  totalFeeStroops: number;
  netAmountStroops: number;
  effectiveFeePercent: string;
}

export class FeePolicyResponseDto {
  id: string;
  name: string;
  recipientType: FeeRecipientType;
  platformFeeBp: number;
  insuranceFeeBp: number;
  flatFeeStroops: number;
  stellarNetworkFeeStroops: number;
  status: FeePolicyStatus;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}
