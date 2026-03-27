import { IsUUID, IsString, IsEnum, IsNumber, IsDate, IsOptional, Min, IsPositive, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

import { UrgencyTier, DistanceBracket, ServiceLevel } from '../entities/fee-policy.entity';

export class CreateFeePolicyDto {
    @IsString()
    @IsNotEmpty()
    geographyCode: string;

    @IsEnum(UrgencyTier)
    urgencyTier: UrgencyTier;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    minDistanceKm: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(0)
    maxDistanceKm?: number;

    @IsEnum(ServiceLevel)
    serviceLevel: ServiceLevel;

    @IsNumber()
    @Type(() => Number)
    @IsPositive()
    deliveryFeeRate: number;

    @IsNumber()
    @Type(() => Number)
    @IsPositive()
    platformFeePct: number;

    @IsNumber()
    @Type(() => Number)
    @IsPositive()
    performanceMultiplier: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(0)
    fixedFee?: number;

    @IsOptional()
    @IsString()
    waivedFor?: string;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(1)
    priority?: number;

    @IsDate()
    @Type(() => Date)
    effectiveFrom: Date;

    @IsOptional()
    @IsDate()
    @Type(() => Date)
    effectiveTo?: Date;
}

import { PartialType } from '@nestjs/mapped-types';

export class UpdateFeePolicyDto extends PartialType(CreateFeePolicyDto) { }

export class FeePreviewDto {
    @IsString()
    geographyCode: string;

    @IsEnum(UrgencyTier)
    urgencyTier: UrgencyTier;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    distanceKm: number;

    @IsEnum(ServiceLevel)
    serviceLevel: ServiceLevel;

    @IsNumber()
    @Type(() => Number)
    @IsPositive()
    quantity: number; // for base amount

    @IsOptional()
    @IsString()
    partnerId?: string; // for waivers
}

export class FeeBreakdownDto {
    @IsUUID()
    appliedPolicyId: string;

    @IsNumber()
    @Type(() => Number)
    baseAmount: number;

    @IsNumber()
    @Type(() => Number)
    deliveryFee: number;

    @IsNumber()
    @Type(() => Number)
    platformFee: number;

    @IsNumber()
    @Type(() => Number)
    performanceFee: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(0)
    fixedFee?: number;

    @IsNumber()
    @Type(() => Number)
    totalFee: number;

    @IsString()
    auditHash: string;
}
