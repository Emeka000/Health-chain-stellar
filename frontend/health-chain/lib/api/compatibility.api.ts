import { api } from './http-client';
import type { CompatibilityResult, PreviewRequest } from '@/lib/types/compatibility';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export async function previewCompatibility(req: PreviewRequest): Promise<CompatibilityResult> {
  return api.post<CompatibilityResult>(`/${PREFIX}/blood-matching/preview`, req);
}

export async function fetchCompatibleDonors(
  recipientType: string,
  component: string,
  allowEmergency = false,
) {
  return api.get(
    `/${PREFIX}/blood-matching/compatible-donors?recipientType=${recipientType}&component=${component}&allowEmergency=${allowEmergency}`,
  );
}
