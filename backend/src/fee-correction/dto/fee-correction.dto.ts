import {
  IsUUID,
  IsString,
  IsDateString,
  IsOptional,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InitiateFeeCorrectionDto {
  /**
   * Caller-supplied idempotency key.
   * Re-submitting with the same key returns the existing run rather than
   * creating a duplicate.
   */
  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  /**
   * The fee policy ID that contained the bug.
   * All orders computed under this policy within the affected window
   * will be discovered and queued for correction.
   */
  @IsUUID()
  policySnapshotId: string;

  /**
   * The replacement/corrected fee policy ID to recompute fees under.
   */
  @IsUUID()
  correctedPolicyId: string;

  /**
   * Start of the affected order window (ISO 8601).
   */
  @IsDateString()
  affectedFrom: string;

  /**
   * End of the affected order window (ISO 8601).
   */
  @IsDateString()
  affectedTo: string;
}

export class ExecuteFeeCorrectionDto {
  /**
   * ID of the FeeCorrectionRunEntity to execute.
   * The run must be in APPROVED status.
   */
  @IsUUID()
  runId: string;

  /**
   * Batch size for processing orders.
   * Smaller batches reduce lock contention; larger batches reduce round-trips.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  batchSize?: number = 100;
}

export class FeeCorrectionRunResponseDto {
  id: string;
  idempotencyKey: string;
  status: string;
  policySnapshotId: string;
  correctedPolicyId: string;
  affectedFrom: Date;
  affectedTo: Date;
  totalAffected: number;
  totalProcessed: number;
  approvalRequestId: string | null;
  initiatedBy: string;
  executedBy: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

export class FeeAdjustmentEntryResponseDto {
  id: string;
  correctionRunId: string;
  orderId: string;
  originalPolicyId: string;
  correctedPolicyId: string;
  originalFeeBreakdown: Record<string, unknown>;
  correctedFeeBreakdown: Record<string, unknown>;
  deltaDeliveryFee: number;
  deltaPlatformFee: number;
  deltaPerformanceFee: number;
  deltaTotalFee: number;
  reconciliationLink: string | null;
  auditHash: string;
  status: string;
  createdAt: Date;
}

export class FeeCorrectionQueryDto {
  @IsOptional()
  @IsUUID()
  runId?: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}
