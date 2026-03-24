import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export const DOC_TYPES = ['inbound', 'outbound', 'transfer'] as const;
export type DocType = typeof DOC_TYPES[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  inbound: 'Entrada',
  outbound: 'Saída',
  transfer: 'Transferência',
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
  issue_date: string | null;
  order_id: string | null;
  load_id: string | null;
  product_summary: string | null;
  pallet_count: number;
  weight_kg: number | null;
  value: number | null;
  status: string;
  created_at: string;
  clients?: { company_name: string } | null;
}

export function useFiscalDocuments() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['fiscal_documents', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('*, clients(company_name)')
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
