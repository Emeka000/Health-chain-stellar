import { api } from './http-client';
import type { PartnerOnboarding, OnboardingStep } from '../types/onboarding';

export const onboardingApi = {
  create: (orgType: string) =>
    api.post<PartnerOnboarding>('/onboarding', { orgType }),
  saveStep: (id: string, step: OnboardingStep, data: Record<string, unknown>) =>
    api.put<PartnerOnboarding>(`/onboarding/${id}/steps`, { step, data }),
  submit: (id: string) =>
    api.post<PartnerOnboarding>(`/onboarding/${id}/submit`, {}),
  getById: (id: string) =>
    api.get<PartnerOnboarding>(`/onboarding/${id}`),
  listPending: () =>
    api.get<PartnerOnboarding[]>('/onboarding'),
  review: (id: string, decision: 'approved' | 'rejected', rejectionReason?: string) =>
    api.post<PartnerOnboarding>(`/onboarding/${id}/review`, { decision, rejectionReason }),
  activate: (id: string, walletAddress: string, licenseNumber: string) =>
    api.post<PartnerOnboarding>(`/onboarding/${id}/activate`, { walletAddress, licenseNumber }),
};
