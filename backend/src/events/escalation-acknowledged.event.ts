export class EscalationAcknowledgedEvent {
  constructor(
    public readonly escalationId: string,
    public readonly acknowledgedBy: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
