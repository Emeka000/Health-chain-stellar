export class RouteDeviationDetectedEvent {
  constructor(
    public readonly incidentId: string,
    public readonly orderId: string,
    public readonly riderId: string,
    public readonly severity: string,
    public readonly deviationDistanceM: number,
    public readonly lastKnownLatitude: number,
    public readonly lastKnownLongitude: number,
    public readonly recommendedAction: string | null,
  ) {}
}
