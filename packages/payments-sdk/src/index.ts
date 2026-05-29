/**
 * @healthchain/payments-sdk
 *
 * TypeScript client bindings for the HealthChain Payments Soroban contract.
 *
 * These bindings mirror the Rust contract interface in
 * lifebank-soroban/contracts/payments/src/lib.rs.
 *
 * To regenerate from a deployed contract run:
 *   stellar contract bindings typescript \
 *     --contract-id <PAYMENTS_CONTRACT_ID> \
 *     --network testnet \
 *     --output-dir packages/payments-sdk
 */

import { xdr } from '@stellar/stellar-sdk';
import {
  BaseContractClient,
  ClientOptions,
  addressToScVal,
  toScVal,
} from '@healthchain/base-sdk';

// ── Enums ─────────────────────────────────────────────────────────────────────

/** Payment lifecycle status. Ordinal values must match the Rust `PaymentStatus` enum. */
export enum PaymentStatus {
  Pending = 0,
  Locked = 1,
  Released = 2,
  Refunded = 3,
  Disputed = 4,
  Cancelled = 5,
}

/** Dispute reason codes. Ordinal values must match the Rust `DisputeReason` enum. */
export enum DisputeReason {
  FailedDelivery = 0,
  TemperatureExcursion = 1,
  PaymentContested = 2,
  WrongItem = 3,
  DamagedGoods = 4,
  LateDelivery = 5,
  Other = 6,
}

function paymentStatusToScVal(status: PaymentStatus): xdr.ScVal {
  return xdr.ScVal.scvU32(status as number);
}

function disputeReasonToScVal(reason: DisputeReason): xdr.ScVal {
  return xdr.ScVal.scvU32(reason as number);
}

// ── Parameter types ───────────────────────────────────────────────────────────

export interface CreatePaymentParams {
  requestId: bigint;
  payer: string;
  payee: string;
  /** Amount in the token's smallest unit (e.g. stroops for XLM). */
  amount: bigint;
}

export interface CreateEscrowParams {
  requestId: bigint;
  hospital: string;
  payee: string;
  amount: bigint;
  /** Token contract address. */
  token: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Typed client for the HealthChain Payments contract.
 *
 * @example
 * ```ts
 * import { Client as PaymentsClient, PaymentStatus } from '@healthchain/payments-sdk';
 *
 * const client = new Client({
 *   contractId: process.env.PAYMENTS_CONTRACT_ID!,
 *   networkPassphrase: Networks.TESTNET,
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   secretKey: process.env.SOROBAN_SECRET_KEY!,
 * });
 *
 * const { transactionHash } = await client.create_escrow({
 *   requestId: BigInt(1),
 *   hospital: 'G...',
 *   payee: 'G...',
 *   amount: BigInt(1000000),
 *   token: 'C...',
 * });
 * ```
 */
export class Client extends BaseContractClient {
  constructor(options: ClientOptions) {
    super(options);
  }

  /**
   * Create a payment record (off-chain escrow, no token transfer).
   *
   * Mirrors: `create_payment(env, request_id, payer, payee, amount)`
   */
  async create_payment(
    params: CreatePaymentParams,
  ): Promise<{ transactionHash: string }> {
    const args: xdr.ScVal[] = [
      toScVal(params.requestId),
      addressToScVal(params.payer),
      addressToScVal(params.payee),
      // amount is i128 in the contract — encode as scvI128
      xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          hi: xdr.Int64.fromString(
            (params.amount >> 64n).toString(),
          ),
          lo: xdr.Uint64.fromString(
            (params.amount & 0xffffffffffffffffn).toString(),
          ),
        }),
      ),
    ];
    const transactionHash = await this.invoke('create_payment', args);
    return { transactionHash };
  }

  /**
   * Create an escrow-backed payment: transfers tokens from hospital into the contract.
   *
   * Mirrors: `create_escrow(env, request_id, hospital, payee, amount, token)`
   */
  async create_escrow(
    params: CreateEscrowParams,
  ): Promise<{ transactionHash: string }> {
    const args: xdr.ScVal[] = [
      toScVal(params.requestId),
      addressToScVal(params.hospital),
      addressToScVal(params.payee),
      xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          hi: xdr.Int64.fromString(
            (params.amount >> 64n).toString(),
          ),
          lo: xdr.Uint64.fromString(
            (params.amount & 0xffffffffffffffffn).toString(),
          ),
        }),
      ),
      addressToScVal(params.token),
    ];
    const transactionHash = await this.invoke('create_escrow', args);
    return { transactionHash };
  }

  /**
   * Update payment status. Used by the coordinator for workflow transitions.
   *
   * Mirrors: `update_status(env, payment_id, status)`
   */
  async update_status(
    paymentId: bigint,
    status: PaymentStatus,
  ): Promise<string> {
    return this.invoke('update_status', [
      toScVal(paymentId),
      paymentStatusToScVal(status),
    ]);
  }

  /**
   * Record a dispute against a payment.
   *
   * Mirrors: `record_dispute(env, payment_id, reason, case_id)`
   */
  async record_dispute(
    paymentId: bigint,
    reason: DisputeReason,
    caseId: string,
  ): Promise<string> {
    return this.invoke('record_dispute', [
      toScVal(paymentId),
      disputeReasonToScVal(reason),
      toScVal(caseId),
    ]);
  }

  /**
   * Resolve a dispute.
   *
   * Mirrors: `resolve_dispute(env, payment_id)`
   */
  async resolve_dispute(paymentId: bigint): Promise<string> {
    return this.invoke('resolve_dispute', [toScVal(paymentId)]);
  }

  /**
   * Release escrowed funds to the payee. Admin only.
   *
   * Mirrors: `release_escrow(env, caller, payment_id)`
   */
  async release_escrow(caller: string, paymentId: bigint): Promise<string> {
    return this.invoke('release_escrow', [
      addressToScVal(caller),
      toScVal(paymentId),
    ]);
  }

  /**
   * Refund escrowed funds to the payer. Admin only.
   *
   * Mirrors: `refund_escrow(env, caller, payment_id)`
   */
  async refund_escrow(caller: string, paymentId: bigint): Promise<string> {
    return this.invoke('refund_escrow', [
      addressToScVal(caller),
      toScVal(paymentId),
    ]);
  }

  /**
   * Get a payment by ID (read-only).
   *
   * Mirrors: `get_payment(env, payment_id)`
   */
  async get_payment(paymentId: bigint): Promise<unknown> {
    return this.simulate('get_payment', [toScVal(paymentId)]);
  }

  /**
   * Get the active payment for a request (read-only).
   *
   * Mirrors: `get_payment_by_request(env, request_id)`
   */
  async get_payment_by_request(requestId: bigint): Promise<unknown> {
    return this.simulate('get_payment_by_request', [toScVal(requestId)]);
  }

  /**
   * Initialize the contract. Called once after deployment.
   *
   * Mirrors: `initialize(env, admin, requests_contract)`
   */
  async initialize(
    admin: string,
    requestsContract?: string | null,
  ): Promise<string> {
    const args: xdr.ScVal[] = [
      addressToScVal(admin),
      requestsContract
        ? addressToScVal(requestsContract)
        : xdr.ScVal.scvVoid(),
    ];
    return this.invoke('initialize', args);
  }
}
