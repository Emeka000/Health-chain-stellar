import { IsString, IsNumber, Min, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

import { UrgencyTier, ServiceLevel } from '../../fee-policy/entities/fee-policy.entity';


export class CreateOrderDto {
    @IsString()
    @IsNotEmpty()
    hospitalId: string;

    @IsString()
    @IsNotEmpty()
    bloodType: string;

    @IsString()
    bloodBankId: string;

    @IsNumber()
    @Min(1)
    @Type(() => Number)
    quantity: number;

    @IsString()
    @IsNotEmpty()
    deliveryAddress: string;

    // Fee policy inputs
    @IsString()
    geographyCode: string;

    @IsEnum(UrgencyTier)
    urgencyTier: UrgencyTier;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    estimatedDistanceKm: number;

    @IsEnum(ServiceLevel)
    serviceLevel: ServiceLevel;

    @IsOptional()
    @IsString()
    partnerId?: string; // for waivers
}

