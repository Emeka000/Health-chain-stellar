export type OnboardingStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'activated';
export type OnboardingStep = 'profile' | 'compliance' | 'contacts' | 'service_areas' | 'wallet';

export interface PartnerOnboarding {
  id: string;
  submittedBy: string;
  orgType: string;
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  data: Record<string, Record<string, unknown>>;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  organizationId: string | null;
  contractTxHash: string | null;
  createdAt: string;
}
