import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

import {
  InFlightConflictPolicy,
  VerificationChangeReason,
} from '../enums/org-lifecycle.enum';

export class SuspendOrganizationDto {
  @IsEnum(VerificationChangeReason)
  reason: VerificationChangeReason;

  @IsString() @MinLength(10)
  note: string;

  /**
   * Grace period in hours before the org transitions to UNVERIFIED.
   * Defaults to 72 hours when omitted.
   */
  @IsInt() @IsPositive() @IsOptional()
  gracePeriodHours?: number;

  /** How to handle in-flight orders. Defaults to DRAIN. */
  @IsEnum(InFlightConflictPolicy) @IsOptional()
  conflictPolicy?: InFlightConflictPolicy;
}

export class ReinstateOrganizationDto {
  @IsEnum(VerificationChangeReason)
  reason: VerificationChangeReason;

  @IsString() @MinLength(10)
  note: string;
}

export class UnverifyOrganizationDto {
  @IsEnum(VerificationChangeReason)
  reason: VerificationChangeReason;

  @IsString() @MinLength(10)
  note: string;

  /** How to handle in-flight orders. Defaults to CANCEL_ALL for immediate unverification. */
  @IsEnum(InFlightConflictPolicy) @IsOptional()
  conflictPolicy?: InFlightConflictPolicy;
}

export class ReapplyOrganizationDto {
  @IsString() @MinLength(5)
  note: string;
}
