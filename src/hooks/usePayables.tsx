import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export const PAYABLE_STATUSES = ['pending', 'approved', 'paid', 'overdue', 'cancelled'] as const;
export type PayableStatus = typeof PAYABLE_STATUSES[number];

export const PAYABLE_STATUS_LABELS: Record<PayableStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovada',
  paid: 'Paga',
  overdue: 'Vencida',
  cancelled: 'Cancelada',
};

export const PAYABLE_CATEGORIES = [
  'supplier', 'fuel', 'toll', 'maintenance', 'tax',
  'payroll', 'driver_advance', 'rent', 'insurance', 'service', 'other',
] as const;

export const PAYABLE_CATEGORY_LABELS: Record<string, string> = {
  supplier: 'Fornecedor',
  fuel: 'Combustível',
  toll: 'Pedágio',
  maintenance: 'Manutenção',
  tax: 'Imposto',
  payroll: 'Folha',
  driver_advance: 'Adiantamento motorista',
  rent: 'Aluguel',
  insurance: 'Seguro',
  service: 'Serviço',
  other: 'Outro',
};

export type Payable = Tables<'payables'>;
export type CreatePayableInput = Omit<TablesInsert<'payables'>, 'tenant_id' | 'created_by'>;
export type UpdatePayableInput = TablesUpdate<'payables'> & { id: string };

export function usePayables() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['payables', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('payables')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('due_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });
}

export function useCreatePayable() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreatePayableInput) => {
      const { data, error } = await supabase.from('payables').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payables'] }),
  });
}

export function useUpdatePayable() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdatePayableInput) => {
      const patch: TablesUpdate<'payables'> = { ...values, updated_at: new Date().toISOString() };
      if (values.status === 'approved' && !values.approved_at) {
        patch.approved_at = new Date().toISOString();
        patch.approved_by = user?.id;
      }
      if (values.status === 'paid' && !values.paid_at) {
        patch.paid_at = new Date().toISOString();
      }
      const { data, error } = await supabase.from('payables').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payables'] }),
  });
}
