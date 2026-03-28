export type ImportEntityType = 'ORGANIZATION' | 'RIDER' | 'INVENTORY';
export type ImportRowStatus = 'VALID' | 'INVALID';
export type ImportBatchStatus = 'STAGED' | 'COMMITTED' | 'REJECTED';

export interface ImportBatch {
  id: string;
  entityType: ImportEntityType;
  status: ImportBatchStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  importedBy: string;
  originalFilename: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportStagingRow {
  id: string;
  batchId: string;
  rowIndex: number;
  data: Record<string, unknown>;
  status: ImportRowStatus;
  errors: string[] | null;
  committedId: string | null;
  createdAt: string;
}

export interface BatchPreview {
  batch: ImportBatch;
  rows: ImportStagingRow[];
}

export interface CommitResult {
  committed: number;
}
