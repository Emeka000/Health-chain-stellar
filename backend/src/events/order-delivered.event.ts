export class OrderDeliveredEvent {
  constructor(
    public readonly orderId: string,
    public readonly hospitalId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
