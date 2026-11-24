/**
 * Jest stub for @healthchain/payments-sdk
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

export type PaymentStatus =
  | 'Pending'
  | 'Locked'
  | 'Released'
  | 'Refunded'
  | 'Disputed'
  | 'Cancelled';

export interface Payment {
  payment_id: bigint;
  status: PaymentStatus;
  amount: bigint;
  timestamp: bigint;
}

export class Client {
  contractId: string;

  constructor(opts: { contractId: string; [key: string]: unknown }) {
    this.contractId = opts.contractId ?? '';
  }

  get_payment(paymentId: bigint): Promise<Payment | null> {
    return Promise.resolve(null);
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */