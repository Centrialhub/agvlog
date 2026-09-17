import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { readTowerSnapshot } from '@/lib/controlTower/contracts';

export function useControlTowerSnapshot() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();

  return useQuery({
    queryKey: ['control-tower-snapshot', currentTenant?.id, user?.id],
    queryFn: async ({ signal }) => {
      if (!currentTenant) throw new Error('Selecione uma empresa antes de consultar a torre.');
      // A read never launches an untracked write or an external integration.
      const { data, error } = await supabase.rpc('get_control_tower_snapshot_v1' as never, {
        _tenant_id: currentTenant.id,
      } as never).abortSignal(signal);
      if (error) throw error;
      return readTowerSnapshot(data, currentTenant.id);
    },
    enabled: !!currentTenant && !!user,
    retry: false,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
