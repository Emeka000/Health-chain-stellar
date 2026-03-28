export class IncidentReviewClosedEvent {
  constructor(
    public readonly reviewId: string,
    public readonly orderId: string,
    public readonly riderId: string | null,
    public readonly hospitalId: string | null,
    public readonly bloodBankId: string | null,
    public readonly rootCause: string,
    public readonly severity: string,
    public readonly affectsScoring: boolean,
    public readonly closedAt: Date,
  ) {}
}
