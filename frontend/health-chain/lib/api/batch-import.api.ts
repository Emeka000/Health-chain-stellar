import { api, httpClient } from './http-client';
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
  return httpClient<ImportBatch>(
    `/${PREFIX}/batch-import/stage?entityType=${entityType}`,
    { method: 'POST', body: form },
  );
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
