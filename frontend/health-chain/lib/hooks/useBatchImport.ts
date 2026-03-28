import { useMutation, useQuery } from '@tanstack/react-query';

import {
  commitBatch,
  fetchBatchPreview,
  stageImport,
} from '@/lib/api/batch-import.api';
import type { ImportEntityType } from '@/lib/types/batch-import';

export function useStageBatch() {
  return useMutation({
    mutationFn: ({ file, entityType }: { file: File; entityType: ImportEntityType }) =>
      stageImport(file, entityType),
  });
}

export function useBatchPreview(batchId: string | null) {
  return useQuery({
    queryKey: ['batch-import', batchId],
    queryFn: () => fetchBatchPreview(batchId!),
    enabled: !!batchId,
  });
}

export function useCommitBatch() {
  return useMutation({
    mutationFn: ({ batchId, rowIds }: { batchId: string; rowIds?: string[] }) =>
      commitBatch(batchId, rowIds),
  });
}
