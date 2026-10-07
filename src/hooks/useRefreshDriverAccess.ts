import { useQueryClient } from '@tanstack/react-query';

export function useRefreshDriverAccess() {
  const queryClient = useQueryClient();
  return () => Promise.all(['driver_access', 'legacy_driver_accounts', 'drivers', 'driver_users_for_link', 'tenant_members'].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
}
