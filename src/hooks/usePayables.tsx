import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

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

export interface Payable {
  id: string;
  tenant_id: string;
  supplier_name: string;
  supplier_id: string | null;
  category: string;
  description: string | null;
  amount: number;
  due_date: string | null;
  competence_date: string | null;
  status: string;
  vehicle_id: string | null;
  driver_id: string | null;
  dispatch_trip_id: string | null;
  load_id: string | null;
  document_number: string | null;
  receipt_url: string | null;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

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
      return (data || []) as unknown as Payable[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreatePayable() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Payable>) => {
      const { data, error } = await supabase.from('payables').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      } as any).select().single();
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
    mutationFn: async ({ id, ...values }: Partial<Payable> & { id: string }) => {
      const patch: any = { ...values, updated_at: new Date().toISOString() };
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