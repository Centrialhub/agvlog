
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { toast } from '@/components/ui/sonner';

export interface CostCenter {
  id: string;
  tenant_id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function useCostCenters() {
  const { currentTenant } = useTenant();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['cost_centers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      
      const { data, error } = await supabase
        .from('cost_centers' as any)
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('name');
        
      if (error) throw error;
      return (data as any[] as CostCenter[]).map(cc => cc.name);
    },
    enabled: !!currentTenant,
  });

  const fullQuery = useQuery({
    queryKey: ['cost_centers_full', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      
      const { data, error } = await supabase
        .from('cost_centers' as any)
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('name');
        
      if (error) throw error;
      return data as any[] as CostCenter[];
    },
    enabled: !!currentTenant,
  });

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!currentTenant) throw new Error('Tenant not found');
      const { error } = await supabase
        .from('cost_centers' as any)
        .insert({ tenant_id: currentTenant.id, name });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost_centers'] });
      queryClient.invalidateQueries({ queryKey: ['cost_centers_full'] });
      toast.success('Centro de custo adicionado com sucesso');
    },
    onError: (err: any) => {
      toast.error('Erro ao adicionar centro de custo: ' + err.message);
    }
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string, active: boolean }) => {
      const { error } = await supabase
        .from('cost_centers' as any)
        .update({ active } as any)
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
