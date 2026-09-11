import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useTenant } from './useTenant';
import { readFinanceAccess, readFinanceMovements } from '@/lib/financial/ledgerClient';
import type { MovementFilters } from '@/lib/financial/ledgerContract';

export function useFinanceAccess() {
  const { currentTenant, currentRole } = useTenant();
  const { user } = useAuth();
  const internal = ['owner', 'admin', 'operator'].includes(currentRole ?? '');
  return useQuery({
    queryKey: ['finance-access', currentTenant?.id, user?.id, currentRole],
    enabled: !!currentTenant && !!user && internal, retry: false, staleTime: 0, refetchOnWindowFocus:true, refetchInterval:30000,
    queryFn: () => readFinanceAccess(currentTenant!.id),
  });
}
export function useFinanceMovements(filters: MovementFilters, enabled: boolean) {
  const { currentTenant } = useTenant(); const { user } = useAuth();
  return useQuery({
    queryKey: ['finance-movements', currentTenant?.id, user?.id, filters],
    enabled: enabled && !!currentTenant && !!user, retry: false,
    queryFn: () => readFinanceMovements(currentTenant!.id, filters),
  });
}
