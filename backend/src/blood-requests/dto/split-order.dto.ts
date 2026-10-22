import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import { FulfillmentLegStatus } from '../entities/fulfillment-leg.entity';

export class AllocationSourceDto {
  @IsString()
  @IsNotEmpty()
  bloodBankId: string;

  @IsString()
  @IsNotEmpty()
  bloodBankName: string;

  @IsArray()
  @IsString({ each: true })
  availableUnits: string[];

  @IsNumber()
  @Min(1)
  quantityMl: number;

  @IsString()
  @IsNotEmpty()
  pickupLocation: string;
}

export class CreateSplitOrderDto {
  @IsString()
  @IsNotEmpty()
  parentRequestId: string;

  @IsArray()
  allocationSources: AllocationSourceDto[];
}

export class UpdateLegStatusDto {
  @IsEnum(FulfillmentLegStatus)
  status: FulfillmentLegStatus;

  @IsOptional()
  @IsString()
  failureReason?: string;

  @IsOptional()
  @IsNumber()
  deliveryTime?: number;
}
