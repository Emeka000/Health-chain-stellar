export class EscalationTriggeredEvent {
  constructor(
    public readonly requestId: string,
    public readonly orderId: string | null,
    public readonly tier: string,
    public readonly hospitalId: string,
    public readonly slaDeadlineMs: number,
    public readonly riderId: string | null,
    public readonly timestamp: Date = new Date(),
  ) {}
}
