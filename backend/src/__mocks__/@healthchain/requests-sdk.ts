/**
 * Jest stub for @healthchain/requests-sdk
 */

export class Client {
  contractId: string;
  constructor(opts: { contractId: string; [key: string]: unknown }) {
    this.contractId = opts.contractId ?? '';
  }
}
