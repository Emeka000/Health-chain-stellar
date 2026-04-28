export type ProofBundleStatus = 'pending' | 'validated' | 'rejected';

export interface ProofBundle {
  id: string;
  paymentId: string;
  deliveryProofId: string;
  deliveryHash: string;
  signatureHash: string;
  photoHash: string;
  medicalHash: string;
  submittedBy: string;
  status: ProofBundleStatus;
  rejectionReason: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidateProofBundlePayload {
  paymentId: string;
  deliveryProofId: string;
  signatureHash: string;
  photoHash: string;
  medicalHash: string;
  submittedBy: string;
}

export interface ValidationResult {
  valid: boolean;
  failures: string[];
  bundle: ProofBundle;
}
