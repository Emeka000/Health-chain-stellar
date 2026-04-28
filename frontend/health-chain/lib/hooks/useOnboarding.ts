import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { onboardingApi } from '../api/onboarding.api';
import type { OnboardingStep } from '../types/onboarding';

export function useOnboarding(id: string) {
  return useQuery({
    queryKey: ['onboarding', id],
    queryFn: () => onboardingApi.getById(id),
    enabled: !!id,
  });
}

export function usePendingOnboardings() {
  return useQuery({
    queryKey: ['onboarding', 'pending'],
    queryFn: () => onboardingApi.listPending(),
  });
}

export function useCreateOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgType: string) => onboardingApi.create(orgType),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding'] }),
  });
}

export function useSaveStep(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ step, data }: { step: OnboardingStep; data: Record<string, unknown> }) =>
      onboardingApi.saveStep(id, step, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', id] }),
  });
}

export function useSubmitOnboarding(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => onboardingApi.submit(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', id] }),
  });
}

export function useReviewOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, rejectionReason }: { id: string; decision: 'approved' | 'rejected'; rejectionReason?: string }) =>
      onboardingApi.review(id, decision, rejectionReason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding'] }),
  });
}

export function useActivateOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, walletAddress, licenseNumber }: { id: string; walletAddress: string; licenseNumber: string }) =>
      onboardingApi.activate(id, walletAddress, licenseNumber),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding'] }),
  });
}
