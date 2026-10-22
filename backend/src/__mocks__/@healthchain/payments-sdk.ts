/**
 * Jest stub for @healthchain/payments-sdk
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
export class Client {
  contractId: string;

  constructor(opts: { contractId: string; [key: string]: unknown }) {
    this.contractId = opts.contractId ?? '';
  }

  get_payment(
    ...args: unknown[]
  ): Promise<{ status: string; amount?: number; timestamp?: string } | null> {
    return Promise.resolve(null);
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */
