import { api } from './http-client';
import type {
  ReadinessChecklist,
  ReadinessEntityType,
  ReadinessItemKey,
  ReadinessItemStatus,
} from '../types/readiness';

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1';

export async function fetchChecklists(entityType?: ReadinessEntityType): Promise<ReadinessChecklist[]> {
  const qs = entityType ? `?entityType=${entityType}` : '';
  return api.get<ReadinessChecklist[]>(`/${PREFIX}/readiness${qs}`);
}

export async function fetchBlockedChecklists(): Promise<ReadinessChecklist[]> {
  return api.get<ReadinessChecklist[]>(`/${PREFIX}/readiness/blocked`);
}

export async function fetchChecklistByEntity(
  type: ReadinessEntityType,
  entityId: string,
): Promise<ReadinessChecklist | null> {
  return api.get<ReadinessChecklist | null>(`/${PREFIX}/readiness/entity/${type}/${entityId}`);
}

export async function updateReadinessItem(
  checklistId: string,
  itemKey: ReadinessItemKey,
  status: ReadinessItemStatus,
  evidenceUrl?: string,
  notes?: string,
): Promise<ReadinessChecklist> {
  return api.patch<ReadinessChecklist>(
    `/${PREFIX}/readiness/${checklistId}/items/${itemKey}`,
    { status, evidenceUrl, notes },
  );
}

export async function signOffChecklist(
  checklistId: string,
  reviewerNotes?: string,
): Promise<ReadinessChecklist> {
  return api.post<ReadinessChecklist>(`/${PREFIX}/readiness/${checklistId}/sign-off`, {
    reviewerNotes,
  });
}
