
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { getErrorMessage } from '@/lib/errors';
import type { Tables } from '@/integrations/supabase/types';
import {CostCenterAlreadyActiveError,costCenterCommandError,costCenterDeleteError,parseCostCenterSaveResult} from '@/lib/financial/costCenterCommand';

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
      const normalizedName = name.trim();
      const {data,error}=await supabase.rpc('create_or_reactivate_cost_center_v1',{
        _tenant_id:currentTenant.id,
        _name:normalizedName,
      });
      if (error) throw error;
      const result=parseCostCenterSaveResult(data,currentTenant.id);
      if(result.status==='already_active')throw new CostCenterAlreadyActiveError();
      return result;
    },
    onSuccess: (result) => {
      toast.success(result.status==='reactivated'?'Centro de custo reativado com sucesso':'Centro de custo adicionado com sucesso');
    },
    onError: (error) => {
      toast.error(costCenterCommandError(error));
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cost_centers'] }),
        queryClient.invalidateQueries({ queryKey: ['cost_centers_full'] }),
      ]);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string, active: boolean }) => {
      if (!currentTenant) throw new Error('Tenant not found');
      const { data, error } = await supabase
        .from('cost_centers')
        .update({ active, updated_at: new Date().toISOString() })
        .eq('tenant_id', currentTenant.id)
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
      if (!data) throw new Error('O status não foi alterado. Atualize a página e tente novamente.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost_centers'] });
      queryClient.invalidateQueries({ queryKey: ['cost_centers_full'] });
      toast.success('Status atualizado');
    },
    onError: (error) => {
      toast.error('Erro ao atualizar centro de custo: ' + getErrorMessage(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!currentTenant) throw new Error('Tenant not found');
      const { data, error } = await supabase
        .from('cost_centers')
        .delete()
        .eq('tenant_id', currentTenant.id)
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
      if (!data) throw new Error('O centro de custo não foi excluído. Atualize a página e tente novamente.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost_centers'] });
      queryClient.invalidateQueries({ queryKey: ['cost_centers_full'] });
      toast.success('Centro de custo excluído');
    },
    onError: (error) => {
      toast.error(costCenterDeleteError(error));
    },
  });

  return {
    data: query.data || [],
    isLoading: query.isLoading,
    fullData: fullQuery.data || [],
    isFullLoading: fullQuery.isLoading,
    isFullError: fullQuery.isError,
    refetchFull: fullQuery.refetch,
    addCostCenter: addMutation.mutateAsync,
    toggleCostCenter: toggleMutation.mutateAsync,
    deleteCostCenter: deleteMutation.mutateAsync,
    isAdding: addMutation.isPending,
    togglingId: toggleMutation.isPending ? toggleMutation.variables?.id ?? null : null,
    deletingId: deleteMutation.isPending ? deleteMutation.variables ?? null : null,
  };
}
