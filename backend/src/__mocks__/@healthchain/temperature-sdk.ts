/**
 * Jest stub for @healthchain/temperature-sdk
 */

export class Client {
  contractId: string;

  constructor(opts: { contractId: string; [key: string]: unknown }) {
    this.contractId = opts.contractId ?? '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  log_reading(..._args: unknown[]): Promise<string> {
    return Promise.resolve('stub-tx');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  get_readings(..._args: unknown[]): Promise<unknown[]> {
    return Promise.resolve([]);
  }
}
