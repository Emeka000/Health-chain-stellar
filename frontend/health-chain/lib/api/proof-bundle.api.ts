import { api } from './http-client';
import type {
  ProofBundle,
  ValidateProofBundlePayload,
  ValidationResult,
} from '@/lib/types/proof-bundle';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export async function validateProofBundle(
  payload: ValidateProofBundlePayload,
): Promise<ValidationResult> {
  return api.post<ValidationResult>(`/${PREFIX}/proof-bundles/validate`, payload);
}

export async function releaseEscrow(
  bundleId: string,
  releasedBy: string,
): Promise<ProofBundle> {
  return api.post<ProofBundle>(`/${PREFIX}/proof-bundles/${bundleId}/release`, { releasedBy });
}

export async function fetchBundlesByPayment(paymentId: string): Promise<ProofBundle[]> {
  return api.get<ProofBundle[]>(`/${PREFIX}/proof-bundles/payment/${paymentId}`);
}
