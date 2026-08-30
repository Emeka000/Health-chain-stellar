/**
 * Jest stub for @healthchain/inventory-sdk
 *
 * The real SDK is generated from the Soroban contract ABI and requires the
 * dist/ folder to be built first (scripts/generate-bindings.sh). During unit
 * tests we provide a minimal stub so that services that import this SDK can
 * be tested in isolation without a full blockchain build environment.
 */

export enum BloodStatus {
  Available = 'Available',
  Reserved = 'Reserved',
  InTransit = 'InTransit',
  Delivered = 'Delivered',
  Compromised = 'Compromised',
  Disposed = 'Disposed',
}

export function bloodTypeFromString(s: string): string {
  return s;
}

/* eslint-disable @typescript-eslint/no-unused-vars */
export class Client {
  contractId: string;

  constructor(opts: { contractId: string; [key: string]: unknown }) {
    this.contractId = opts.contractId ?? '';
  }

  register_blood(
    ...args: unknown[]
  ): Promise<{ transactionHash: string; unitId: bigint }> {
    return Promise.resolve({ transactionHash: 'stub-tx', unitId: BigInt(0) });
  }

  update_status(...args: unknown[]): Promise<string> {
    return Promise.resolve('stub-tx');
  }

  is_authorized_bank(...args: unknown[]): Promise<boolean> {
    return Promise.resolve(false);
  }

  get_readings(...args: unknown[]): Promise<unknown[]> {
    return Promise.resolve([]);
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */
