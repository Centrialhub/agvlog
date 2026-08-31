
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { getErrorMessage } from '@/lib/errors';
import type { Tables } from '@/integrations/supabase/types';

export type CostCenter = Tables<'cost_centers'>;

export function useCostCenters() {
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['cost_centers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      
      const { data, error } = await supabase
        .from('cost_centers')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('name');
        
      if (error) throw error;
      return data.map(cc => cc.name);
    },
    enabled: !!currentTenant,
  });

  const fullQuery = useQuery({
    queryKey: ['cost_centers_full', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      
      const { data, error } = await supabase
        .from('cost_centers')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('name');
        
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!currentTenant) throw new Error('Tenant not found');
      const { error } = await supabase
        .from('cost_centers')
        .insert({ tenant_id: currentTenant.id, name });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost_centers'] });
      queryClient.invalidateQueries({ queryKey: ['cost_centers_full'] });
      toast.success('Centro de custo adicionado com sucesso');
    },
    onError: (error) => {
      toast.error('Erro ao adicionar centro de custo: ' + getErrorMessage(error));
    }
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string, active: boolean }) => {
      const { error } = await supabase
        .from('cost_centers')
        .update({ active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost_centers'] });
      queryClient.invalidateQueries({ queryKey: ['cost_centers_full'] });
      toast.success('Status atualizado');
    }
  });

  return {
    data: query.data || [],
    isLoading: query.isLoading,
    fullData: fullQuery.data || [],
    isFullLoading: fullQuery.isLoading,
    addCostCenter: addMutation.mutateAsync,
    toggleCostCenter: toggleMutation.mutateAsync,
  };
}
