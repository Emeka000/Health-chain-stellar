import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import { ContractDomain } from '../entities/contract-event.entity';

export class QueryContractEventsDto {
  @IsOptional()
  @IsEnum(ContractDomain)
  domain?: ContractDomain;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsString()
  entityRef?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  pageSize?: number = 25;
}

export class ReplayFromLedgerDto {
  @IsInt()
  @Min(0)
  @Type(() => Number)
  fromLedger: number;

  @IsOptional()
  @IsEnum(ContractDomain)
  domain?: ContractDomain;

  /**
   * Scope replay to a specific projection. Omit to reset all projections for the domain.
   */
  @IsOptional()
  @IsString()
  projectionName?: string;
}

export class IngestEventDto {
  @IsEnum(ContractDomain)
  domain: ContractDomain;

  @IsString()
  eventType: string;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  ledgerSequence: number;

  /**
   * Hash of the ledger at ledgerSequence.
   * When provided, the indexer uses it to detect chain reorganizations.
   */
  @IsOptional()
  @IsString()
  ledgerHash?: string;

  @IsOptional()
  @IsString()
  txHash?: string;

  @IsOptional()
  @IsString()
  contractRef?: string;

  payload: Record<string, unknown>;

  @IsOptional()
  @IsString()
  entityRef?: string;

  /**
   * Canonical idempotency key: ledger:txHash:eventIndex:schemaVersion.
   * When provided, overrides the auto-generated SHA-256 dedup key.
   */
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class QuarantinePoisonEventDto {
  @IsString()
  dedupKey: string;

  @IsString()
  projectionName: string;

  payload: Record<string, unknown>;

  @IsString()
  errorMessage: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  attemptCount?: number;
}

export class ReplayPoisonEventDto {
  @IsString()
  poisonEventId: string;

  @IsOptional()
  @IsString()
  operatorNotes?: string;
}

export class DiscardPoisonEventDto {
  @IsString()
  poisonEventId: string;

  @IsOptional()
  @IsString()
  operatorNotes?: string;
}

/**
 * Operator-initiated cursor reset.
 * Resets one or all cursors to a safe ledger without deleting indexed events.
 * Use when a cursor is corrupted but events are still valid.
 */
export class CursorResetDto {
  @IsInt()
  @Min(0)
  @Type(() => Number)
  toLedger: number;

  @IsOptional()
  @IsEnum(ContractDomain)
  domain?: ContractDomain;

  @IsOptional()
  @IsString()
  projectionName?: string;
}

/**
 * Verify indexed data integrity for a ledger range.
 * Returns count of events and whether any gaps exist.
 */
export class VerifyIndexedDto {
  @IsInt()
  @Min(0)
  @Type(() => Number)
  fromLedger: number;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  toLedger: number;

  @IsOptional()
  @IsEnum(ContractDomain)
  domain?: ContractDomain;
}
