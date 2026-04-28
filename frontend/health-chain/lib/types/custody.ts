export type CustodyActor = 'blood_bank' | 'rider' | 'hospital';
export type CustodyHandoffStatus = 'pending' | 'confirmed' | 'cancelled';

export interface CustodyHandoff {
  id: string;
  bloodUnitId: string;
  orderId: string | null;
  fromActorId: string;
  fromActorType: CustodyActor;
  toActorId: string;
  toActorType: CustodyActor;
  status: CustodyHandoffStatus;
  latitude: number | null;
  longitude: number | null;
  proofReference: string | null;
  contractEventId: string | null;
  confirmedAt: string | null;
  createdAt: string;
}
