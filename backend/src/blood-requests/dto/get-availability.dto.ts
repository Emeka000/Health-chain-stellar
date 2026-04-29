import { IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { BloodComponent } from '../../blood-units/enums/blood-component.enum';
import { BloodType } from '../../blood-units/enums/blood-type.enum';

export class GetAvailabilityRequestDto {
  @IsEnum(BloodType)
  bloodType: BloodType;

  @IsEnum(BloodComponent)
  @IsOptional()
  component?: BloodComponent;

  @Type(() => Number)
  @IsOptional()
  latitude?: number;

  @Type(() => Number)
  @IsOptional()
  longitude?: number;

  @IsOptional()
  deliveryAddress?: string;

  @Type(() => Number)
  @IsOptional()
  maxDistanceKm?: number;

  @Type(() => Number)
  @IsOptional()
  maxResultsCount?: number;
}

export interface BloodBankAvailabilityDto {
  bloodBankId: string;
  bloodBankName: string;
  address: string;
  latitude: number;
  longitude: number;
  bloodType: BloodType;
  component: BloodComponent;
  availableQuantityMl: number;
  reservedQuantityMl: number;
  estDeliveryTimeMinutes: number;
  confidenceScore: number;
  stockFreshness: number;
  reservationRisk: number;
  dispatchLoad: number;
  compatibilitySummary: string;
  capacityBreakdown?: {
    outstandingDispatches: number;
    availableRiders: number;
    slaRisk: number;
    failureRate: number;
    coldChainUtilization: number;
  };
}

export interface GetAvailabilityResponseDto {
  success: boolean;
  requestId: string;
  timestamp: string;
  query: {
    bloodType: BloodType;
    component: BloodComponent;
    latitude?: number;
    longitude?: number;
  };
  results: BloodBankAvailabilityDto[];
  summary: {
    totalBanksFound: number;
    topChoiceEta: number | null;
    topChoiceConfidence: number | null;
  };
}
