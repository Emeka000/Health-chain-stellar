/**
 * @healthchain/base-sdk
 *
 * Shared base client for all HealthChain Soroban contract SDKs.
 *
 * This module provides the typed scaffolding that the generated per-contract
 * clients build on. When `stellar contract bindings typescript` is run against
 * a deployed contract it produces a package with the same shape as the
 * individual SDK packages here — this base layer captures the common
 * connection/signing logic so each contract SDK stays thin.
 *
 * NOTE: The actual `stellar contract bindings typescript` command must be run
 * after deploying to testnet (see scripts/generate-bindings.sh). Until then
 * these hand-written bindings mirror the Rust contract interfaces exactly and
 * serve as the authoritative TypeScript source of truth.
 */

import {
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Keypair,
  xdr,
  Address,
} from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';
import * as SorobanRpc from '@stellar/stellar-sdk/rpc';

export interface ClientOptions {
  /** Deployed contract address (C... Strkey). */
  contractId: string;
  /** Stellar network passphrase. Use `Networks.TESTNET` or `Networks.PUBLIC`. */
  networkPassphrase: string;
  /** Soroban RPC endpoint URL. */
  rpcUrl: string;
  /** Secret key of the transaction source account. */
  secretKey: string;
  /** Optional transaction timeout in seconds (default: 30). */
  timeoutSeconds?: number;
}

export type ScValLike =
  | xdr.ScVal
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

/**
 * Encode a JavaScript value to an `xdr.ScVal`.
 *
 * Supported mappings:
 *   string  → scvString
 *   number  → scvU32 (integers) or scvI32 (negative integers)
 *   bigint  → scvU64 / scvI64
 *   boolean → scvBool
 *   null/undefined → scvVoid
 *   xdr.ScVal → passed through unchanged
 */
export function toScVal(value: ScValLike): xdr.ScVal {
  if (value instanceof xdr.ScVal) return value;
  if (value === null || value === undefined) return xdr.ScVal.scvVoid();
  if (typeof value === 'boolean') return xdr.ScVal.scvBool(value);
  if (typeof value === 'string') return xdr.ScVal.scvString(value);
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new TypeError(`Non-integer numbers are not supported: ${value}`);
    }
    return value >= 0
      ? xdr.ScVal.scvU32(value)
      : xdr.ScVal.scvI32(value);
  }
  if (typeof value === 'bigint') {
    return value >= 0n
      ? xdr.ScVal.scvU64(xdr.Uint64.fromString(value.toString()))
      : xdr.ScVal.scvI64(xdr.Int64.fromString(value.toString()));
  }
  throw new TypeError(`Unsupported value type: ${typeof value}`);
}

/**
 * Encode a Stellar public key string to an `xdr.ScVal` of type `scvAddress`.
 */
export function addressToScVal(publicKey: string): xdr.ScVal {
  return xdr.ScVal.scvAddress(
    xdr.ScAddress.scAddressTypeAccount(
      Keypair.fromPublicKey(publicKey).xdrPublicKey(),
    ),
  );
}

/**
 * Encode an optional value: `Some(v)` → encoded ScVal, `None` → `scvVoid`.
 */
export function optionToScVal(value: ScValLike): xdr.ScVal {
  if (value === null || value === undefined) return xdr.ScVal.scvVoid();
  return toScVal(value);
}

/**
 * Decode an `xdr.ScVal` to a JavaScript primitive.
 */
export function fromScVal(val: xdr.ScVal): unknown {
  switch (val.switch().name) {
    case 'scvU32':
      return (val.value() as xdr.Uint32).valueOf();
    case 'scvI32':
      return (val.value() as xdr.Int32).valueOf();
    case 'scvU64':
      return BigInt((val.value() as xdr.Uint64).toString());
    case 'scvI64':
      return BigInt((val.value() as xdr.Int64).toString());
    case 'scvBool':
      return Boolean(val.value());
    case 'scvString':
      return (val.value() as Buffer).toString('utf-8');
    case 'scvSymbol':
      return (val.value() as Buffer).toString('utf-8');
    case 'scvVoid':
      return null;
    case 'scvMap': {
      const entries = val.value() as xdr.ScMapEntry[];
      const result: Record<string, unknown> = {};
      for (const entry of entries) {
        const key = fromScVal(entry.key()) as string;
        result[key] = fromScVal(entry.val());
      }
      return result;
    }
    case 'scvVec': {
      const items = val.value() as xdr.ScVal[];
      return items.map(fromScVal);
    }
    default:
      return val.value();
  }
}

/**
 * Base Soroban contract client.
 *
 * Each generated contract SDK extends this class and adds typed methods that
 * call `this.invoke()` or `this.simulate()` with the appropriate arguments.
 */
export abstract class BaseContractClient {
  protected readonly server: Server;
  protected readonly contract: Contract;
  protected readonly keypair: Keypair;
  protected readonly networkPassphrase: string;
  protected readonly timeoutSeconds: number;

  constructor(options: ClientOptions) {
    this.server = new Server(options.rpcUrl);
    this.contract = new Contract(options.contractId);
    this.keypair = Keypair.fromSecret(options.secretKey);
    this.networkPassphrase = options.networkPassphrase;
    this.timeoutSeconds = options.timeoutSeconds ?? 30;
  }

  /** The contract address this client is bound to. */
  get contractId(): string {
    return this.contract.contractId();
  }

  /**
   * Submit a state-mutating contract call and wait for confirmation.
   *
   * @param method  - Contract function name (snake_case, matching Rust)
   * @param args    - Ordered list of `xdr.ScVal` arguments
   * @returns Transaction hash of the confirmed transaction
   */
  protected async invoke(method: string, args: xdr.ScVal[]): Promise<string> {
    const account = await this.server.getAccount(this.keypair.publicKey());

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(this.timeoutSeconds)
      .build();

    transaction.sign(this.keypair);

    const response = await this.server.sendTransaction(transaction);

    if (response.status !== 'PENDING') {
      throw new Error(
        `Transaction submission failed with status: ${response.status}`,
      );
    }

    await this.pollForCompletion(response.hash);
    return response.hash;
  }

  /**
   * Simulate a read-only contract call and return the decoded result.
   *
   * @param method - Contract function name
   * @param args   - Ordered list of `xdr.ScVal` arguments
   * @returns Decoded return value
   */
  protected async simulate(method: string, args: xdr.ScVal[]): Promise<unknown> {
    const account = await this.server.getAccount(this.keypair.publicKey());

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(this.timeoutSeconds)
      .build();

    const simulated = await this.server.simulateTransaction(transaction);

    if (!SorobanRpc.Api.isSimulationSuccess(simulated)) {
      const errResp = simulated as SorobanRpc.Api.SimulateTransactionErrorResponse;
      throw new Error(`Simulation failed: ${errResp.error}`);
    }

    const retval = simulated.result?.retval;
    if (!retval) return null;
    return fromScVal(retval);
  }

  /** Poll until the transaction reaches SUCCESS or FAILED. */
  private async pollForCompletion(
    hash: string,
    maxAttempts = 30,
    intervalMs = 1000,
  ): Promise<SorobanRpc.Api.GetTransactionResponse> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await this.server.getTransaction(hash);

      if (response.status === 'SUCCESS') return response;
      if (response.status === 'FAILED') {
        throw new Error(`Transaction failed on-chain: ${hash}`);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Transaction polling timed out after ${maxAttempts}s: ${hash}`);
  }
}
