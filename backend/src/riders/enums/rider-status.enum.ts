export enum RiderStatus {
  AVAILABLE = 'AVAILABLE',
  ON_DELIVERY = 'ON_DELIVERY',
  OFFLINE = 'OFFLINE',
  BUSY = 'BUSY',
}

export const ALLOWED_STATUS_TRANSITIONS: Record<RiderStatus, RiderStatus[]> = {
  [RiderStatus.AVAILABLE]: [
    RiderStatus.ON_DELIVERY,
    RiderStatus.BUSY,
    RiderStatus.OFFLINE,
  ],
  [RiderStatus.ON_DELIVERY]: [RiderStatus.AVAILABLE, RiderStatus.OFFLINE],
  [RiderStatus.BUSY]: [RiderStatus.AVAILABLE, RiderStatus.OFFLINE],
  [RiderStatus.OFFLINE]: [RiderStatus.AVAILABLE],
};
