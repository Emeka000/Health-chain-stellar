import { IsString, IsEnum, IsOptional, IsDateString } from 'class-validator';
import { DeferralReason } from '../enums/eligibility.enum';

export class CreateDeferralDto {
  @IsString()
  donorId: string;

  @IsEnum(DeferralReason)
  reason: DeferralReason;

  @IsDateString()
  @IsOptional()
  deferredUntil?: string; // omit for permanent

  @IsString()
  @IsOptional()
  notes?: string;
}

export class OverrideDeferralDto {
  @IsString()
  donorId: string;

  @IsEnum(DeferralReason)
  reason: DeferralReason;

  @IsDateString()
  @IsOptional()
  deferredUntil?: string;

  @IsString()
  overrideReason: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class SimulateEligibilityDto {
  @IsString()
  donorId: string;

  /** Proposed rule version ID to simulate against */
  @IsString()
  @IsOptional()
  ruleVersionId?: string;

  /** Simulate as of this date (ISO string) */
  @IsDateString()
  @IsOptional()
  asOfDate?: string;
}
