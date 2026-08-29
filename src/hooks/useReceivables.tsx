import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export const RECEIVABLE_STATUSES = ['pending', 'invoiced', 'received', 'cancelled'] as const;
export type ReceivableStatus = typeof RECEIVABLE_STATUSES[number];

export const RECEIVABLE_STATUS_LABELS: Record<ReceivableStatus, string> = {
  pending: 'Pendente',
  invoiced: 'Faturado',
  received: 'Recebido',
  cancelled: 'Cancelado',
};

export type Receivable = Tables<'receivables'> & {
  clients?: { company_name: string } | null;
};

export type CreateReceivableInput = Omit<TablesInsert<'receivables'>, 'tenant_id' | 'created_by'>;
export type UpdateReceivableInput = TablesUpdate<'receivables'> & { id: string };

export function useReceivables() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['receivables', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('receivables')
        .select('*, clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateReceivable() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateReceivableInput) => {
      const { data, error } = await supabase.from('receivables').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['receivables'] }),
  });
}

export function useUpdateReceivable() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdateReceivableInput) => {
      const { data, error } = await supabase.from('receivables').update({
        ...values,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      }).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['receivables'] }),
  });
}
