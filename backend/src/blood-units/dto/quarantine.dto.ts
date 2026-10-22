import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  QuarantineDisposition,
  QuarantineReasonCode,
  QuarantineReviewState,
  QuarantineTriggerSource,
} from '../enums/quarantine.enums';

export class EvidenceDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  fileId: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateQuarantineCaseDto {
  @IsUUID('4')
  bloodUnitId: string;

  @IsEnum(QuarantineTriggerSource)
  triggerSource: QuarantineTriggerSource;

  @IsEnum(QuarantineReasonCode)
  reasonCode: QuarantineReasonCode;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  policyReference?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvidenceDto)
  @ArrayMinSize(1)
  evidence: EvidenceDto[];
}

export class AssignQuarantineReviewerDto {
  @IsString()
  @IsNotEmpty()
  reviewerAssignedTo: string;
}

export class UpdateQuarantineReviewDto {
  @IsEnum(QuarantineReviewState)
  reviewState: QuarantineReviewState;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class FinalizeQuarantineDto {
  @IsEnum(QuarantineDisposition)
  disposition: QuarantineDisposition;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  policyReference?: string;
}

export class QueryQuarantineCasesDto {
  @IsOptional()
  @IsEnum(QuarantineReviewState)
  reviewState?: QuarantineReviewState;

  @IsOptional()
  @IsEnum(QuarantineTriggerSource)
  triggerSource?: QuarantineTriggerSource;

  @IsOptional()
  @IsEnum(QuarantineReasonCode)
  reasonCode?: QuarantineReasonCode;

  @IsOptional()
  @IsString()
  reviewerAssignedTo?: string;

  @IsOptional()
  @IsUUID('4')
  bloodUnitId?: string;

  @IsOptional()
  @IsString()
  active?: string;
}
