import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export const DOC_TYPES = ['inbound', 'outbound', 'transfer'] as const;
export type DocType = typeof DOC_TYPES[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  inbound: 'NF-e Entrada',
  outbound: 'CT-e / Saída',
  transfer: 'Transferência',
};

export const DOC_STATUSES = ['pending', 'confirmed', 'cancelled'] as const;
export type DocStatus = typeof DOC_STATUSES[number];

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  pending: 'Pendente',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
};

export interface FiscalDocument {
  id: string;
  tenant_id: string;
  document_type: DocType;
  invoice_number: string | null;
  access_key: string | null;
  client_id: string | null;
  remitter: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  recipient_neighborhood: string | null;
  issue_date: string | null;
  order_id: string | null;
  load_id: string | null;
  product_summary: string | null;
  pallet_count: number;
  weight_kg: number | null;
  value: number | null;
  freight_value: number | null;
  freight_breakdown: any | null;
  freight_table_id: string | null;
  client_load_number: string | null;
  client_load_source: { source: string; ruleId?: string | null; ruleLabel?: string | null } | null;
  cbs_base: number | null;
  cbs_rate: number | null;
  cbs_value: number | null;
  ibs_base: number | null;
  ibs_rate: number | null;
  ibs_value: number | null;
  status: string;
  created_at: string;
  clients?: { company_name: string } | null;
  loads?: { load_number: string } | null;
  orders?: { order_number: string } | null;
}

export function useFiscalDocuments() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['fiscal_documents', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('*, clients(company_name), loads(load_number), orders(order_number)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as FiscalDocument[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateFiscalDocument() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<FiscalDocument>) => {
      const { data, error } = await supabase.from('fiscal_documents').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      } as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fiscal_documents'] }),
  });
}

export function useUpdateFiscalDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<FiscalDocument> & { id: string }) => {
      const { data, error } = await supabase.from('fiscal_documents').update({
        ...values,
        updated_at: new Date().toISOString(),
      } as any).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fiscal_documents'] }),
  });
}
