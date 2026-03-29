import { api } from './http-client';
import type { RolePermissions } from '../types/permissions';

export const permissionsApi = {
  getAll: () => api.get<RolePermissions[]>('/permissions'),
  getByRole: (role: string) => api.get<RolePermissions>(`/permissions/role/${role}`),
};
