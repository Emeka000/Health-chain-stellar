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

// ── Struct types ──────────────────────────────────────────────────────────────

/**
 * Decoded on-chain `Payment` struct.
 *
 * Mirrors the Rust `Payment` struct in
 * lifebank-soroban/contracts/payments/src/lib.rs.
 */
export interface Payment {
  paymentId: bigint;
  requestId: bigint;
  payer: string;
  payee: string;
  /** Amount in the token's smallest unit (e.g. stroops for XLM). */
  amount: bigint;
  /** Token contract address, if the payment is escrow-backed. */
  token: string | null;
  status: PaymentStatus;
  /** Ledger timestamp (seconds since epoch) when the payment was created. */
  timestamp: bigint;
  /** Dispute reason, present only when `status === PaymentStatus.Disputed`. */
  disputeReason: DisputeReason | null;
  /** Case ID associated with a dispute, if any. */
  caseId: string | null;
}

// ── Decoding helpers ──────────────────────────────────────────────────────────

function scValToBigInt(value: xdr.ScVal): bigint {
  switch (value.switch()) {
    case xdr.ScValType.scvU32():
      return BigInt(value.u32());
    case xdr.ScValType.scvI32():
      return BigInt(value.i32());
    case xdr.ScValType.scvU64():
      return BigInt(value.u64().toString());
    case xdr.ScValType.scvI64():
      return BigInt(value.i64().toString());
    case xdr.ScValType.scvU128(): {
      const parts = value.u128();
      return (BigInt(parts.hi().toString()) << 64n) | BigInt(parts.lo().toString());
    }
    case xdr.ScValType.scvI128(): {
      const parts = value.i128();
      return (BigInt(parts.hi().toString()) << 64n) | BigInt(parts.lo().toString());
    }
    default:
      throw new Error(`Cannot decode ScVal of type ${value.switch().name} as integer`);
  }
}

function scValToAddress(value: xdr.ScVal): string {
  // Address ScVals are decoded by the base SDK; fall back to the raw string form.
  try {
    return (value as unknown as { address(): { toString(): string } })
      .address()
      .toString();
  } catch {
    return value.toXDR('base64');
  }
}

function scValToString(value: xdr.ScVal): string {
  switch (value.switch()) {
    case xdr.ScValType.scvString():
      return value.str().toString();
    case xdr.ScValType.scvSymbol():
      return value.sym().toString();
    default:
      return value.toXDR('base64');
  }
}

function scValToPaymentStatus(value: xdr.ScVal): PaymentStatus {
  const ordinal = Number(scValToBigInt(value));
  const status = PaymentStatus[ordinal as keyof typeof PaymentStatus];
  if (typeof status !== 'number') {
    throw new Error(`Unknown PaymentStatus ordinal: ${ordinal}`);
  }
  return status;
}

function scValToDisputeReason(value: xdr.ScVal): DisputeReason {
  const ordinal = Number(scValToBigInt(value));
  const reason = DisputeReason[ordinal as keyof typeof DisputeReason];
  if (typeof reason !== 'number') {
    throw new Error(`Unknown DisputeReason ordinal: ${ordinal}`);
  }
  return reason;
}

function getStructField(entries: xdr.ScMapEntry[], name: string): xdr.ScVal | undefined {
  const entry = entries.find((e) => scValToString(e.key()) === name);
  return entry?.val();
}

/**
 * Decode a Soroban `Payment` struct ScVal into a typed {@link Payment}.
 */
export function decodePayment(value: xdr.ScVal): Payment {
  if (value.switch() !== xdr.ScValType.scvMap()) {
    throw new Error(`Expected Payment struct (scvMap), got ${value.switch().name}`);
  }
  const entries = value.map() ?? [];
  const required = (name: string): xdr.ScVal => {
    const field = getStructField(entries, name);
    if (!field) {
      throw new Error(`Payment struct is missing field '${name}'`);
    }
    return field;
  };
  const optional = (name: string): xdr.ScVal | undefined => {
    const field = getStructField(entries, name);
    if (!field || field.switch() === xdr.ScValType.scvVoid()) {
      return undefined;
    }
    return field;
  };

  const token = optional('token');
  const disputeReason = optional('dispute_reason');
  const caseId = optional('case_id');

  return {
    paymentId: scValToBigInt(required('payment_id')),
    requestId: scValToBigInt(required('request_id')),
    payer: scValToAddress(required('payer')),
    payee: scValToAddress(required('payee')),
    amount: scValToBigInt(required('amount')),
    token: token ? scValToAddress(token) : null,
    status: scValToPaymentStatus(required('status')),
    timestamp: scValToBigInt(required('timestamp')),
    disputeReason: disputeReason ? scValToDisputeReason(disputeReason) : null,
    caseId: caseId ? scValToString(caseId) : null,
  };
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
   * Mirrors: `get_payment(env, payment_id: u64) -> Payment`
   */
  async get_payment(paymentId: bigint): Promise<Payment> {
    const result = await this.simulate('get_payment', [toScVal(paymentId)]);
    return decodePayment(result as xdr.ScVal);
  }

  /**
   * Get the active payment for a request (read-only).
   *
   * Mirrors: `get_payment_by_request(env, request_id: u64) -> Payment`
   */
  async get_payment_by_request(requestId: bigint): Promise<Payment> {
    const result = await this.simulate('get_payment_by_request', [
      toScVal(requestId),
    ]);
    return decodePayment(result as xdr.ScVal);
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
