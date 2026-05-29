/**
 * @healthchain/temperature-sdk
 *
 * TypeScript client bindings for the HealthChain Temperature Soroban contract.
 *
 * These bindings mirror the Rust contract interface in
 * lifebank-soroban/contracts/temperature/src/lib.rs.
 *
 * To regenerate from a deployed contract run:
 *   stellar contract bindings typescript \
 *     --contract-id <TEMPERATURE_CONTRACT_ID> \
 *     --network testnet \
 *     --output-dir packages/temperature-sdk
 */

import { xdr } from '@stellar/stellar-sdk';
import {
  BaseContractClient,
  ClientOptions,
  addressToScVal,
  toScVal,
} from '@healthchain/base-sdk';

// ── Parameter types ───────────────────────────────────────────────────────────

export interface LogReadingParams {
  unitId: bigint;
  /**
   * Temperature in Celsius × 100 (e.g. 250 = 2.50°C).
   * This matches the contract's `temperature_celsius_x100: i32` parameter.
   */
  temperatureCelsiusX100: number;
  /** Unix timestamp of the reading. */
  timestamp: bigint;
}

export interface SetThresholdParams {
  admin: string;
  unitId: bigint;
  minCelsiusX100: number;
  maxCelsiusX100: number;
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
 * Typed client for the HealthChain Temperature contract.
 *
 * @example
 * ```ts
 * import { Client as TemperatureClient } from '@healthchain/temperature-sdk';
 *
 * const client = new Client({
 *   contractId: process.env.TEMPERATURE_CONTRACT_ID!,
 *   networkPassphrase: Networks.TESTNET,
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   secretKey: process.env.SOROBAN_SECRET_KEY!,
 * });
 *
 * await client.log_reading({
 *   unitId: BigInt(42),
 *   temperatureCelsiusX100: 250,  // 2.50°C
 *   timestamp: BigInt(Math.floor(Date.now() / 1000)),
 * });
 * ```
 */
export class Client extends BaseContractClient {
  constructor(options: ClientOptions) {
    super(options);
  }

  /**
   * Log a temperature reading for a blood unit.
   *
   * Mirrors: `log_reading(env, unit_id, temperature_celsius_x100, timestamp)`
   */
  async log_reading(params: LogReadingParams): Promise<string> {
    const args: xdr.ScVal[] = [
      toScVal(params.unitId),
      xdr.ScVal.scvI32(params.temperatureCelsiusX100),
      toScVal(params.timestamp),
    ];
    return this.invoke('log_reading', args);
  }

  /**
   * Set the acceptable temperature threshold for a blood unit. Admin only.
   *
   * Mirrors: `set_threshold(env, admin, unit_id, min_celsius_x100, max_celsius_x100)`
   */
  async set_threshold(params: SetThresholdParams): Promise<string> {
    const args: xdr.ScVal[] = [
      addressToScVal(params.admin),
      toScVal(params.unitId),
      xdr.ScVal.scvI32(params.minCelsiusX100),
      xdr.ScVal.scvI32(params.maxCelsiusX100),
    ];
    return this.invoke('set_threshold', args);
  }

  /**
   * Report a sustained temperature excursion to the coordinator contract.
   * Only the admin or a whitelisted IoT oracle may call this.
   *
   * Mirrors: `report_excursion_to_coordinator(env, caller, unit_id, payment_id, excursion_summary)`
   */
  async report_excursion_to_coordinator(
    caller: string,
    unitId: bigint,
    paymentId: bigint,
    excursion: ExcursionSummary,
  ): Promise<string> {
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
      toScVal(unitId),
      toScVal(paymentId),
      summaryMap,
    ];
    return this.invoke('report_excursion_to_coordinator', args);
  }

  /**
   * Get all temperature violations for a blood unit (read-only).
   *
   * Mirrors: `get_violations(env, unit_id)`
   */
  async get_violations(unitId: bigint): Promise<unknown> {
    return this.simulate('get_violations', [toScVal(unitId)]);
  }

  /**
   * Get all temperature readings for a blood unit (read-only).
   *
   * Mirrors: `get_readings(env, unit_id)`
   */
  async get_readings(unitId: bigint): Promise<unknown> {
    return this.simulate('get_readings', [toScVal(unitId)]);
  }

  /**
   * Get temperature summary statistics for a blood unit (read-only).
   *
   * Mirrors: `get_temperature_summary(env, unit_id)`
   */
  async get_temperature_summary(unitId: bigint): Promise<unknown> {
    return this.simulate('get_temperature_summary', [toScVal(unitId)]);
  }

  /**
   * Check whether a blood unit has been compromised (read-only).
   *
   * Mirrors: `is_compromised(env, unit_id)`
   */
  async is_compromised(unitId: bigint): Promise<boolean> {
    const result = await this.simulate('is_compromised', [toScVal(unitId)]);
    return Boolean(result);
  }

  /**
   * Initialize the contract. Called once after deployment.
   *
   * Mirrors: `initialize(env, admin)`
   */
  async initialize(admin: string): Promise<string> {
    return this.invoke('initialize', [addressToScVal(admin)]);
  }
}
