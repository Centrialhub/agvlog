import { useQuery } from '@tanstack/react-query';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { listContractorCteSources } from '@/lib/ingestion/contractorCteRepository';

export function useContractorCteSources(search = '', enabled = true) {
  const { currentTenant, currentRole } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['contractor-cte-sources', currentTenant?.id, user?.id, currentRole, search],
    enabled: enabled && Boolean(currentTenant && user && ['owner', 'admin', 'operator'].includes(currentRole ?? '')),
    queryFn: () => listContractorCteSources(currentTenant!.id, search),
  });
}
