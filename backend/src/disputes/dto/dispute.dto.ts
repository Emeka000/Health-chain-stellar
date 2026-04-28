import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DisputeOutcome, DisputeReasonTaxonomy, DisputeSeverity } from '../enums/dispute.enum';

export class OpenDisputeDto {
  @IsString()
  @IsOptional()
  orderId?: string;

  @IsString()
  @IsOptional()
  paymentId?: string;

  @IsEnum(DisputeReasonTaxonomy)
  reason: DisputeReasonTaxonomy;

  @IsEnum(DisputeSeverity)
  @IsOptional()
  severity?: DisputeSeverity;

  @IsString()
  @IsOptional()
  description?: string;
}

export class ResolveDisputeDto {
  @IsString()
  resolutionNotes: string;

  /** Structured outcome required for arbitration traceability (#585). */
  @IsEnum(DisputeOutcome)
  outcome: DisputeOutcome;

  /** Identity of the arbitrator recording the resolution. */
  @IsString()
  resolvedBy: string;
}

export class AddNoteDto {
  @IsString()
  content: string;
}

export class AssignDisputeDto {
  @IsString()
  operatorId: string;
}
