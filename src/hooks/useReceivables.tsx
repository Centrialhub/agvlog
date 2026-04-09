import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export const RECEIVABLE_STATUSES = ['pending', 'invoiced', 'received', 'cancelled'] as const;
export type ReceivableStatus = typeof RECEIVABLE_STATUSES[number];

export const RECEIVABLE_STATUS_LABELS: Record<ReceivableStatus, string> = {
  pending: 'Pendente',
  invoiced: 'Faturado',
  received: 'Recebido',
  cancelled: 'Cancelado',
};

export interface Receivable {
  id: string;
  tenant_id: string;
  order_id: string | null;
  fiscal_document_id: string | null;
  load_id: string | null;
  client_id: string | null;
  description: string | null;
  invoice_number: string | null;
  amount: number;
  due_date: string | null;
  status: string;
  received_at: string | null;
  received_amount: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  clients?: { company_name: string } | null;
}

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
      return (data || []) as unknown as Receivable[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateReceivable() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Receivable>) => {
      const { data, error } = await supabase.from('receivables').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      } as any).select().single();
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
    mutationFn: async ({ id, ...values }: Partial<Receivable> & { id: string }) => {
      const { data, error } = await supabase.from('receivables').update({
        ...values,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      } as any).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['receivables'] }),
  });
}
