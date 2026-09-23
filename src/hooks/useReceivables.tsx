import { useMutation, useQueryClient } from '@tanstack/react-query';
import {saveManualTitle} from '@/lib/financial/manualTitleCommand';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export const RECEIVABLE_STATUSES = ['pending', 'invoiced', 'partial', 'received', 'cancelled'] as const;
export type ReceivableStatus = typeof RECEIVABLE_STATUSES[number];

export const RECEIVABLE_STATUS_LABELS: Record<ReceivableStatus, string> = {
  pending: 'Pendente',
  invoiced: 'Faturado',
  partial: 'Parcialmente liquidado',
  received: 'Liquidado',
  cancelled: 'Cancelado',
};

export type Receivable = Tables<'receivables'> & {
  clients?: { company_name: string } | null;
};

export type CreateReceivableInput = Omit<TablesInsert<'receivables'>, 'tenant_id' | 'created_by'> & {duplicate_reason?:string};
export type UpdateReceivableInput = TablesUpdate<'receivables'> & { id: string; expected_updated_at:string };

export function useCreateReceivable() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({duplicate_reason='',...values}: CreateReceivableInput) => {
      if(!currentTenant?.id||!user?.id)throw new Error('Sessão financeira indisponível.');
      return await saveManualTitle(currentTenant.id,user.id,'receivable',values,null,null,duplicate_reason) as Receivable;
    },
    onSuccess: () => Promise.all(['receivables','finance-receivable-portfolio','finance-receivable-history'].map(key=>qc.invalidateQueries({queryKey:[key]}))),
  });
}

export function useUpdateReceivable() {
  const {currentTenant}=useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({id,expected_updated_at,...values}: UpdateReceivableInput) => {
      if(!currentTenant?.id||!user?.id)throw new Error('Sessão financeira indisponível.');
      if(!expected_updated_at)throw new Error('Reabra o título para conferir a revisão original.');
      return await saveManualTitle(currentTenant.id,user.id,'receivable',values,id,expected_updated_at) as Receivable;
    },
    onSuccess: () => Promise.all(['receivables','finance-receivable-portfolio','finance-receivable-history'].map(key=>qc.invalidateQueries({queryKey:[key]}))),
  });
}
