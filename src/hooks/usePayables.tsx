import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {saveManualTitle} from '@/lib/financial/manualTitleCommand';
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
export const isPayableDirectlyEditable=(payable:Pick<Payable,'source_table'|'source_id'>)=>payable.source_table===null&&payable.source_id===null;
export type CreatePayableInput = Omit<TablesInsert<'payables'>, 'tenant_id' | 'created_by'> & {duplicate_reason?:string};
export type UpdatePayableInput = Omit<TablesUpdate<'payables'>,'updated_at'> & { id: string; expected_updated_at: string };

export function useCreatePayable() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({duplicate_reason='',...values}: CreatePayableInput) => {
      if(!currentTenant?.id||!user?.id)throw new Error('Sessão financeira indisponível.');
      return await saveManualTitle(currentTenant.id,user.id,'payable',values,null,null,duplicate_reason) as Payable;
    },
    onSuccess: async (data) => { await Promise.all([invalidateAccountReview(qc,data.tenant_id),qc.invalidateQueries({ queryKey: ['payables'] }),qc.invalidateQueries({queryKey:['finance-payable-portfolio',data.tenant_id]}),Promise.all([qc.invalidateQueries({ queryKey: ['finance-recorded-costs'] }),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]),qc.invalidateQueries({ queryKey: ['finance-settlement-expense-context'] })]); },
  });
}

export function useUpdatePayable() {
  const {user}=useAuth();
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({id,expected_updated_at,...values}: UpdatePayableInput) => {
      if(values.status==='approved'||'approved_at' in values||'approved_by' in values)throw new Error('A aprovação exige a conferência própria do valor e do favorecido.');
      if(!currentTenant?.id||!user?.id)throw new Error('Sessão financeira indisponível.');
      if(!expected_updated_at)throw new Error('Reabra a conta para conferir a revisão original.');
      return await saveManualTitle(currentTenant.id,user.id,'payable',values,id,expected_updated_at) as Payable;
    },
    onSuccess: async (data) => { await Promise.all([invalidateAccountReview(qc,data.tenant_id),qc.invalidateQueries({ queryKey: ['payables'] }),qc.invalidateQueries({queryKey:['finance-payable-portfolio',data.tenant_id]}),Promise.all([qc.invalidateQueries({ queryKey: ['finance-recorded-costs'] }),qc.invalidateQueries({queryKey:['finance-recorded-cost-summary']})]),qc.invalidateQueries({ queryKey: ['finance-settlement-expense-context'] })]); },
  });
}
