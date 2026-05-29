/**
 * @healthchain/coordinator-sdk
 *
 * TypeScript client bindings for the HealthChain Coordinator Soroban contract.
 *
 * These bindings mirror the Rust contract interface in
 * lifebank-soroban/contracts/coordinator/src/lib.rs.
 *
 * To regenerate from a deployed contract run:
 *   stellar contract bindings typescript \
 *     --contract-id <COORDINATOR_CONTRACT_ID> \
 *     --network testnet \
 *     --output-dir packages/coordinator-sdk
 */

import { xdr } from '@stellar/stellar-sdk';
import {
  BaseContractClient,
  ClientOptions,
  addressToScVal,
  toScVal,
} from '@healthchain/base-sdk';

// ── Parameter types ───────────────────────────────────────────────────────────

export interface AllocateUnitsParams {
  /** Correlation ID of the blood request being fulfilled. */
  requestId: bigint;
  /** IDs of the inventory units to allocate. */
  unitIds: bigint[];
  /** Payment ID that will be locked during the workflow. */
  paymentId: bigint;
  /** Address of the caller (hospital or blood bank). */
  caller: string;
}

export interface ConfirmDeliveryParams {
  requestId: bigint;
  caller: string;
  /** GPS coordinate or facility identifier. */
  location: string;
}

export interface SettlePaymentParams {
  requestId: bigint;
  caller: string;
}

export interface ExcursionSummary {
  unitId: bigint;
  violationCount: number;
  minTempCelsiusX100: number;
  maxTempCelsiusX100: number;
  startTimestamp: bigint;
  endTimestamp: bigint;
}

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Typed client for the HealthChain Coordinator contract.
 *
 * The coordinator enforces the canonical three-step workflow:
 *   1. `allocate_units`   – reserves inventory units for a pending request
 *   2. `confirm_delivery` – marks units as delivered
 *   3. `settle_payment`   – releases escrowed payment to the blood bank
 *
 * @example
 * ```ts
 * import { Client as CoordinatorClient } from '@healthchain/coordinator-sdk';
 *
 * const client = new Client({
 *   contractId: process.env.COORDINATOR_CONTRACT_ID!,
 *   networkPassphrase: Networks.TESTNET,
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   secretKey: process.env.SOROBAN_SECRET_KEY!,
 * });
 *
 * await client.allocate_units({
 *   requestId: BigInt(123),
 *   unitIds: [BigInt(1), BigInt(2)],
 *   paymentId: BigInt(456),
 *   caller: 'G...',
 * });
 * ```
 */
export class Client extends BaseContractClient {
  constructor(options: ClientOptions) {
    super(options);
  }

  /**
   * Step 1 – Allocate inventory units to a pending request.
   *
   * Mirrors: `allocate_units(env, request_id, unit_ids, payment_id, caller)`
   */
  async allocate_units(params: AllocateUnitsParams): Promise<string> {
    const unitIdsVec = xdr.ScVal.scvVec(
      params.unitIds.map((id) => toScVal(id)),
    );
    const args: xdr.ScVal[] = [
      toScVal(params.requestId),
      unitIdsVec,
      toScVal(params.paymentId),
      addressToScVal(params.caller),
    ];
    return this.invoke('allocate_units', args);
  }

  /**
   * Step 2 – Confirm delivery of all allocated units.
   *
   * Mirrors: `confirm_delivery(env, request_id, caller, location)`
   */
  async confirm_delivery(params: ConfirmDeliveryParams): Promise<string> {
    const args: xdr.ScVal[] = [
      toScVal(params.requestId),
      addressToScVal(params.caller),
      toScVal(params.location),
    ];
    return this.invoke('confirm_delivery', args);
  }

  /**
   * Step 3 – Settle payment after confirmed delivery.
   *
   * Mirrors: `settle_payment(env, request_id, caller)`
   */
  async settle_payment(params: SettlePaymentParams): Promise<string> {
    const args: xdr.ScVal[] = [
      toScVal(params.requestId),
      addressToScVal(params.caller),
    ];
    return this.invoke('settle_payment', args);
  }

  /**
   * Admin-only rollback: releases units and refunds payment.
   *
   * Mirrors: `rollback(env, request_id)`
   */
  async rollback(requestId: bigint): Promise<string> {
    return this.invoke('rollback', [toScVal(requestId)]);
  }

  /**
   * Flag a temperature breach, transitioning the linked payment to Disputed.
   *
   * Mirrors: `flag_temperature_breach(env, caller, payment_id, excursion_summary)`
   */
  async flag_temperature_breach(
    caller: string,
    paymentId: bigint,
    excursion: ExcursionSummary,
  ): Promise<string> {
    // ExcursionSummary is a contracttype struct — encode as scvMap
    const summaryMap = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('unit_id'),
        val: toScVal(excursion.unitId),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('violation_count'),
        val: toScVal(excursion.violationCount),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('min_temp_celsius_x100'),
        val: xdr.ScVal.scvI32(excursion.minTempCelsiusX100),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('max_temp_celsius_x100'),
        val: xdr.ScVal.scvI32(excursion.maxTempCelsiusX100),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('start_timestamp'),
        val: toScVal(excursion.startTimestamp),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('end_timestamp'),
        val: toScVal(excursion.endTimestamp),
      }),
    ]);

    const args: xdr.ScVal[] = [
      addressToScVal(caller),
      toScVal(paymentId),
      summaryMap,
    ];
    return this.invoke('flag_temperature_breach', args);
  }

  /**
   * Get the workflow record for a request (read-only).
   *
   * Mirrors: `get_workflow(env, request_id)`
   */
  async get_workflow(requestId: bigint): Promise<unknown> {
    return this.simulate('get_workflow', [toScVal(requestId)]);
  }

  /**
   * Initialize the coordinator contract. Called once after deployment.
   *
   * Mirrors: `initialize(env, admin, request_contract, inventory_contract, payment_contract)`
   */
  async initialize(
    admin: string,
    requestContract: string,
    inventoryContract: string,
    paymentContract: string,
  ): Promise<string> {
    const args: xdr.ScVal[] = [
      addressToScVal(admin),
      addressToScVal(requestContract),
      addressToScVal(inventoryContract),
      addressToScVal(paymentContract),
    ];
    return this.invoke('initialize', args);
  }

  /**
   * Pause all state-mutating functions. Admin only.
   *
   * Mirrors: `pause(env, admin)`
   */
  async pause(admin: string): Promise<string> {
    return this.invoke('pause', [addressToScVal(admin)]);
  }

  /**
   * Unpause the contract. Admin only.
   *
   * Mirrors: `unpause(env, admin)`
   */
  async unpause(admin: string): Promise<string> {
    return this.invoke('unpause', [addressToScVal(admin)]);
  }

  /**
   * Emergency halt — blocks all in-flight workflow steps. Admin only.
   *
   * Mirrors: `emergency_halt(env, admin)`
   */
  async emergency_halt(admin: string): Promise<string> {
    return this.invoke('emergency_halt', [addressToScVal(admin)]);
  }

  /**
   * Clear the emergency halt flag. Admin only.
   *
   * Mirrors: `clear_emergency_halt(env, admin)`
   */
  async clear_emergency_halt(admin: string): Promise<string> {
    return this.invoke('clear_emergency_halt', [addressToScVal(admin)]);
  }
}
