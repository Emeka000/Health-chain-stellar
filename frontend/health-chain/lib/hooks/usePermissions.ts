import { useQuery } from '@tanstack/react-query';
import { permissionsApi } from '../api/permissions.api';

export function usePermissions() {
  return useQuery({
    queryKey: ['permissions', 'all'],
    queryFn: () => permissionsApi.getAll(),
  });
}
