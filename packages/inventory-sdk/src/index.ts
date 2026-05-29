/**
 * @healthchain/inventory-sdk
 *
 * TypeScript client bindings for the HealthChain Inventory Soroban contract.
 *
 * These bindings are hand-written to match the Rust contract interface in
 * lifebank-soroban/contracts/inventory/src/lib.rs exactly.
 *
 * To regenerate from a deployed contract run:
 *   stellar contract bindings typescript \
 *     --contract-id <INVENTORY_CONTRACT_ID> \
 *     --network testnet \
 *     --output-dir packages/inventory-sdk
 *
 * The generated output will replace this file. Until then this file is the
 * authoritative TypeScript source of truth for the inventory contract interface.
 */

import { xdr, Keypair } from '@stellar/stellar-sdk';
import {
  BaseContractClient,
  ClientOptions,
  addressToScVal,
  optionToScVal,
  toScVal,
} from '@healthchain/base-sdk';

// ── Enums ─────────────────────────────────────────────────────────────────────

/**
 * Blood type enum. Ordinal values must match the Rust `BloodType` enum exactly.
 */
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

/**
 * Blood unit lifecycle status. Ordinal values must match the Rust `BloodStatus` enum.
 */
export enum BloodStatus {
  Available = 0,
  Reserved = 1,
  InTransit = 2,
  Delivered = 3,
  Expired = 4,
  Compromised = 5,
  Disposed = 6,
}

// ── Type helpers ──────────────────────────────────────────────────────────────

/** Map a human-readable blood type string to the contract enum ordinal. */
export function bloodTypeFromString(bloodType: string): BloodType {
  const map: Record<string, BloodType> = {
    'A+': BloodType.APositive,
    'A-': BloodType.ANegative,
    'B+': BloodType.BPositive,
    'B-': BloodType.BNegative,
    'AB+': BloodType.ABPositive,
    'AB-': BloodType.ABNegative,
    'O+': BloodType.OPositive,
    'O-': BloodType.ONegative,
  };
  const normalized = bloodType.trim().toUpperCase();
  const value = map[normalized];
  if (value === undefined) {
    throw new Error(`Invalid blood type: ${bloodType}`);
  }
  return value;
}

function bloodTypeToScVal(bloodType: BloodType): xdr.ScVal {
  return xdr.ScVal.scvU32(bloodType as number);
}

function bloodStatusToScVal(status: BloodStatus): xdr.ScVal {
  return xdr.ScVal.scvU32(status as number);
}

// ── Parameter types ───────────────────────────────────────────────────────────

export interface RegisterBloodParams {
  /** Authorized blood bank address. */
  bankId: string;
  /** Unique physical serial number of the blood bag. */
  serialNumber: string;
  bloodType: BloodType;
  /** Quantity in millilitres (100–600). */
  quantityMl: number;
  /** Optional donor address. Pass `null` for anonymous donations. */
  donorId?: string | null;
}

export interface UpdateStatusParams {
  unitId: bigint;
  newStatus: BloodStatus;
  /** Address authorizing the status change (admin or owning bank). */
  authorizedBy: string;
  /** Optional reason / notes. */
  reason?: string | null;
}

export interface ReserveBloodParams {
  requester: string;
  unitIds: bigint[];
  requestId: bigint;
  /** How long the reservation is valid, in seconds. */
  durationSeconds: bigint;
}

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Typed client for the HealthChain Inventory contract.
 *
 * @example
 * ```ts
 * import { Client as InventoryClient, BloodType } from '@healthchain/inventory-sdk';
 *
 * const client = new Client({
 *   contractId: process.env.INVENTORY_CONTRACT_ID!,
 *   networkPassphrase: Networks.TESTNET,
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   secretKey: process.env.SOROBAN_SECRET_KEY!,
 * });
 *
 * const { transactionHash, unitId } = await client.register_blood({
 *   bankId: 'G...',
 *   serialNumber: 'SN-001',
 *   bloodType: BloodType.OPositive,
 *   quantityMl: 450,
 * });
 * ```
 */
export class Client extends BaseContractClient {
  constructor(options: ClientOptions) {
    super(options);
  }

  /**
   * Register a new blood donation into the inventory.
   *
   * Mirrors: `register_blood(env, bank_id, serial_number, blood_type, quantity_ml, donor_id)`
   */
  async register_blood(
    params: RegisterBloodParams,
  ): Promise<{ transactionHash: string; unitId: bigint }> {
    const args: xdr.ScVal[] = [
      addressToScVal(params.bankId),
      toScVal(params.serialNumber),
      bloodTypeToScVal(params.bloodType),
      toScVal(params.quantityMl),
      optionToScVal(params.donorId ? params.donorId : null),
    ];

    const transactionHash = await this.invoke('register_blood', args);

    // The contract returns the new unit ID as u64. We return 0n as a sentinel
    // here because the actual return value requires parsing the transaction
    // result — callers that need the ID should query get_blood_unit after
    // confirmation or listen for the BloodRegistered event.
    return { transactionHash, unitId: 0n };
  }

  /**
   * Update the status of a blood unit.
   *
   * Mirrors: `update_status(env, unit_id, new_status, authorized_by, reason)`
   */
  async update_status(params: UpdateStatusParams): Promise<string> {
    const args: xdr.ScVal[] = [
      toScVal(params.unitId),
      bloodStatusToScVal(params.newStatus),
      addressToScVal(params.authorizedBy),
      optionToScVal(params.reason ?? null),
    ];
    return this.invoke('update_status', args);
  }

  /**
   * Mark a blood unit as delivered.
   *
   * Mirrors: `mark_delivered(env, unit_id, authorized_by, delivery_location)`
   */
  async mark_delivered(
    unitId: bigint,
    authorizedBy: string,
    deliveryLocation: string,
  ): Promise<string> {
    const args: xdr.ScVal[] = [
      toScVal(unitId),
      addressToScVal(authorizedBy),
      toScVal(deliveryLocation),
    ];
    return this.invoke('mark_delivered', args);
  }

  /**
   * Reserve one or more blood units for a hospital requester.
   *
   * Mirrors: `reserve_blood(env, requester, unit_ids, request_id, duration_seconds)`
   */
  async reserve_blood(
    params: ReserveBloodParams,
  ): Promise<{ transactionHash: string }> {
    const unitIdsVec = xdr.ScVal.scvVec(
      params.unitIds.map((id) => toScVal(id)),
    );
    const args: xdr.ScVal[] = [
      addressToScVal(params.requester),
      unitIdsVec,
      toScVal(params.requestId),
      toScVal(params.durationSeconds),
    ];
    const transactionHash = await this.invoke('reserve_blood', args);
    return { transactionHash };
  }

  /**
   * Release a reservation, returning all units to Available.
   *
   * Mirrors: `release_reservation(env, reservation_id)`
   */
  async release_reservation(reservationId: bigint): Promise<string> {
    return this.invoke('release_reservation', [toScVal(reservationId)]);
  }

  /**
   * Dispose of a blood unit (terminal state).
   *
   * Mirrors: `dispose(env, unit_id, authorized_by, reason)`
   */
  async dispose(
    unitId: bigint,
    authorizedBy: string,
    reason?: string | null,
  ): Promise<string> {
    const args: xdr.ScVal[] = [
      toScVal(unitId),
      addressToScVal(authorizedBy),
      optionToScVal(reason ?? null),
    ];
    return this.invoke('dispose', args);
  }

  /**
   * Get blood unit details by ID (read-only simulation).
   *
   * Mirrors: `get_blood_unit(env, blood_unit_id)`
   */
  async get_blood_unit(unitId: bigint): Promise<unknown> {
    return this.simulate('get_blood_unit', [toScVal(unitId)]);
  }

  /**
   * Check whether a bank address is authorized.
   *
   * Mirrors: `is_authorized_bank(env, bank)`
   */
  async is_authorized_bank(bankId: string): Promise<boolean> {
    const result = await this.simulate('is_authorized_bank', [
      addressToScVal(bankId),
    ]);
    return Boolean(result);
  }

  /**
   * Initialize the contract. Should only be called once after deployment.
   *
   * Mirrors: `initialize(env, admin)`
   */
  async initialize(admin: string): Promise<string> {
    return this.invoke('initialize', [addressToScVal(admin)]);
  }
}
