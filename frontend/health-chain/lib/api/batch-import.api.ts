import { api } from './http-client';
import type {
  BatchPreview,
  CommitResult,
  ImportBatch,
  ImportEntityType,
} from '@/lib/types/batch-import';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export async function stageImport(
  file: File,
  entityType: ImportEntityType,
): Promise<ImportBatch> {
  const form = new FormData();
  form.append('file', file);
  // Use raw fetch — http-client sets Content-Type: application/json by default
  const { useAuthStore } = await import('@/lib/stores/auth.store');
  const token = useAuthStore.getState().accessToken;
  const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const res = await fetch(
    `${base}/${PREFIX}/batch-import/stage?entityType=${entityType}`,
    {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchBatchPreview(batchId: string): Promise<BatchPreview> {
  return api.get<BatchPreview>(`/${PREFIX}/batch-import/${batchId}`);
}

export async function commitBatch(
  batchId: string,
  rowIds?: string[],
): Promise<CommitResult> {
  return api.post<CommitResult>(`/${PREFIX}/batch-import/${batchId}/commit`, { rowIds });
}
