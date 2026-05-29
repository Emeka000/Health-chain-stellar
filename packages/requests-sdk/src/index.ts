/**
 * @healthchain/requests-sdk
 *
 * TypeScript client bindings for the HealthChain Requests Soroban contract.
 *
 * These bindings mirror the Rust contract interface in
 * lifebank-soroban/contracts/requests/src/lib.rs.
 *
 * To regenerate from a deployed contract run:
 *   stellar contract bindings typescript \
 *     --contract-id <REQUESTS_CONTRACT_ID> \
 *     --network testnet \
 *     --output-dir packages/requests-sdk
 */

import { xdr } from '@stellar/stellar-sdk';
import {
  BaseContractClient,
  ClientOptions,
  addressToScVal,
  toScVal,
} from '@healthchain/base-sdk';

// ── Enums ─────────────────────────────────────────────────────────────────────

/** Blood type enum. Ordinal values must match the Rust `BloodType` enum. */
export enum BloodType {
  APositive = 0,
  ANegative = 1,
  BPositive = 2,
  BNegative = 3,
  ABPositive = 4,
  ABNegative = 5,
  OPositive = 6,
  ONegative = 7,
}

/** Blood component enum. Ordinal values must match the Rust `BloodComponent` enum. */
export enum BloodComponent {
  WholeBlood = 0,
  RedBloodCells = 1,
  Plasma = 2,
  Platelets = 3,
  Cryoprecipitate = 4,
}

/** Request urgency level. Ordinal values must match the Rust `Urgency` enum. */
export enum Urgency {
  Routine = 0,
  Urgent = 1,
  Emergency = 2,
}

/** Request lifecycle status. Ordinal values must match the Rust `RequestStatus` enum. */
export enum RequestStatus {
  Pending = 0,
  Approved = 1,
  InProgress = 2,
  Fulfilled = 3,
  Cancelled = 4,
  Rejected = 5,
}

function bloodTypeToScVal(bt: BloodType): xdr.ScVal {
  return xdr.ScVal.scvU32(bt as number);
}

function bloodComponentToScVal(bc: BloodComponent): xdr.ScVal {
  return xdr.ScVal.scvU32(bc as number);
}

function urgencyToScVal(u: Urgency): xdr.ScVal {
  return xdr.ScVal.scvU32(u as number);
}

function requestStatusToScVal(s: RequestStatus): xdr.ScVal {
  return xdr.ScVal.scvU32(s as number);
}

// ── Parameter types ───────────────────────────────────────────────────────────

export interface CreateRequestParams {
  hospital: string;
  bloodType: BloodType;
  component: BloodComponent;
  /** Quantity in millilitres. */
  quantityMl: number;
  urgency: Urgency;
  /** Unix timestamp by which the blood is required. */
  requiredByTimestamp: bigint;
}

export interface UpdateRequestStatusParams {
  caller: string;
  requestId: bigint;
  newStatus: RequestStatus;
  reason: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Typed client for the HealthChain Requests contract.
 *
 * @example
 * ```ts
 * import { Client as RequestsClient, BloodType, BloodComponent, Urgency } from '@healthchain/requests-sdk';
 *
 * const client = new Client({
 *   contractId: process.env.REQUESTS_CONTRACT_ID!,
 *   networkPassphrase: Networks.TESTNET,
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   secretKey: process.env.SOROBAN_SECRET_KEY!,
 * });
 *
 * const { transactionHash } = await client.create_request({
 *   hospital: 'G...',
 *   bloodType: BloodType.OPositive,
 *   component: BloodComponent.WholeBlood,
 *   quantityMl: 450,
 *   urgency: Urgency.Urgent,
 *   requiredByTimestamp: BigInt(Math.floor(Date.now() / 1000) + 86400),
 * });
 * ```
 */
export class Client extends BaseContractClient {
  constructor(options: ClientOptions) {
    super(options);
  }

  /**
   * Create a new blood request.
   *
   * Mirrors: `create_request(env, hospital, blood_type, component, quantity_ml, urgency, required_by_timestamp)`
   */
  async create_request(
    params: CreateRequestParams,
  ): Promise<{ transactionHash: string }> {
    const args: xdr.ScVal[] = [
      addressToScVal(params.hospital),
      bloodTypeToScVal(params.bloodType),
      bloodComponentToScVal(params.component),
      toScVal(params.quantityMl),
      urgencyToScVal(params.urgency),
      toScVal(params.requiredByTimestamp),
    ];
    const transactionHash = await this.invoke('create_request', args);
    return { transactionHash };
  }

  /**
   * Cancel a blood request. Only the owning hospital or admin may cancel.
   *
   * Mirrors: `cancel_request(env, caller, request_id, reason)`
   */
  async cancel_request(
    caller: string,
    requestId: bigint,
    reason: string,
  ): Promise<string> {
    return this.invoke('cancel_request', [
      addressToScVal(caller),
      toScVal(requestId),
      toScVal(reason),
    ]);
  }

  /**
   * Update the status of a blood request. Admin only.
   *
   * Mirrors: `update_request_status(env, caller, request_id, new_status, reason)`
   */
  async update_request_status(
    params: UpdateRequestStatusParams,
  ): Promise<string> {
    return this.invoke('update_request_status', [
      addressToScVal(params.caller),
      toScVal(params.requestId),
      requestStatusToScVal(params.newStatus),
      toScVal(params.reason),
    ]);
  }

  /**
   * Get a blood request by ID (read-only).
   *
   * Mirrors: `get_request(env, request_id)`
   */
  async get_request(requestId: bigint): Promise<unknown> {
    return this.simulate('get_request', [toScVal(requestId)]);
  }

  /**
   * Get contract metadata (read-only).
   *
   * Mirrors: `get_metadata(env)`
   */
  async get_metadata(): Promise<unknown> {
    return this.simulate('get_metadata', []);
  }

  /**
   * Initialize the contract. Called once after deployment.
   *
   * Mirrors: `initialize(env, admin, inventory_contract)`
   */
  async initialize(admin: string, inventoryContract: string): Promise<string> {
    return this.invoke('initialize', [
      addressToScVal(admin),
      addressToScVal(inventoryContract),
    ]);
  }
}
