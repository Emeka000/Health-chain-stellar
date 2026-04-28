export class TxPendingEvent {
  constructor(
    public readonly transactionHash: string,
    public readonly contractMethod: string,
    public readonly metadata: Record<string, unknown> | null = null,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class TxConfirmedEvent {
  constructor(
    public readonly transactionHash: string,
    public readonly contractMethod: string,
    public readonly confirmations: number,
    public readonly finalityThreshold: number,
    public readonly metadata: Record<string, unknown> | null = null,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class TxFinalEvent {
  constructor(
    public readonly transactionHash: string,
    public readonly contractMethod: string,
    public readonly confirmations: number,
    public readonly metadata: Record<string, unknown> | null = null,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class TxFailedEvent {
  constructor(
    public readonly transactionHash: string,
    public readonly contractMethod: string,
    public readonly failureReason: string | null,
    public readonly metadata: Record<string, unknown> | null = null,
    public readonly timestamp: Date = new Date(),
  ) {}
}
