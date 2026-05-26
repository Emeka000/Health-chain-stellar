export class VerificationSyncStatusDto {
  id!: string;
  name!: string;
  status?: string | null;
  syncStatus?: string | null;
  verificationSource?: string | null;
  verifiedAt?: Date | null;
  syncedAt?: Date | null;
  verificationTxHash?: string | null;
  sorobanVerifiedAt?: Date | null;
  syncErrorMessage?: string | null;
  syncRetryCount?: number;
}
