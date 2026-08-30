import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Contract methods this endpoint is allowed to submit. Mirrors the methods
 * actually invoked by trusted internal services (WorkflowOrchestrationService,
 * BloodRequestsService, OrganizationsService) plus the on-chain contract
 * surface documented in `../contracts/lifebank-contracts.ts`.
 */
export const ALLOWED_SOROBAN_CONTRACT_METHODS = [
  // inventory
  'register_blood',
  'reserve_blood',
  'release_reservation',
  'update_status',
  // requests
  'create_request',
  'create_blood_request',
  'get_request',
  'get_metadata',
  // payments
  'create_payment',
  'order_payment',
  'create_escrow',
  'record_dispute',
  'resolve_dispute',
  // custody
  'transfer_custody',
  'log_temperature',
  // order/workflow orchestration
  'allocate_units',
  'confirm_delivery',
  'settle_payment',
  'rollback',
  // organizations
  'register_verified_organization',
] as const;

export class SubmitTransactionDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(ALLOWED_SOROBAN_CONTRACT_METHODS)
  contractMethod: string;

  @IsArray()
  @ArrayMaxSize(20)
  args: unknown[];

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxRetries?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
