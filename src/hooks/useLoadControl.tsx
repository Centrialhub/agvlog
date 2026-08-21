// guardrail:allow-direct-write
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export const PAYMENT_STATUS_LABELS = {
  unpaid: 'Não Pago',
  partially_paid: 'Parcial',
  paid: 'Pago',
  overdue: 'Vencido',
  disputed: 'Contestado',
  cancelled: 'Cancelado',
};

export const OPERATIONAL_STATUS_LABELS = {
  assembling: 'Montagem',
  ready: 'Pronto',
  loading: 'Carregando',
  loaded: 'Carregado',
  in_transit: 'Em Trânsito',
  delivered: 'Entregue',
};

export const BILLING_STATUS_LABELS = {
  pending: 'Pendente',
  billed: 'Faturado',
};

export interface LoadControlRow {
  id: string;
  load_number: string;
  external_load_number?: string;
  client_name?: string;
  load_date?: string;
  arrival_date?: string;
  status: string;
  operational_status?: string;
  billing_status?: string;
  payment_status: string;
  freight_amount: number;
  received_amount: number;
  freight_percent?: number;
  total_weight_kg?: number;
  invoice_count?: number;
  cte_count?: number;
  driver_name?: string;
  plate?: string;
  expected_payment_date?: string;
  payment_date?: string;
  gross_cargo_value?: number;
  client_invoice_id?: string;
  receivable_id?: string;
  cte_numbers?: string[];
  legacy_status_text?: string;
}

export interface UnloadingChargeRow {
  id: string;
  load_id: string;
  amount: number;
  description: string;
  created_at: string;
  invoice_number?: string;
  client_name?: string;
  supplier_name?: string;
  city?: string;
  service_date?: string;
  load?: { external_load_number?: string; load_number?: string };
  status?: string;
}

export interface LoadControlFilters {
  search?: string;
  payment_status?: string[];
  operational_status?: string[];
  loadNumber?: string;
  paymentStatus?: string[];
  loadDateFrom?: string;
  loadDateTo?: string;
  expectedPayFrom?: string;
  expectedPayTo?: string;
}

export function useLoadControlList(filters: LoadControlFilters = {}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['load-control', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return [];
      
      const { data, error } = await supabase.rpc('list_load_control_v1', {
        p_tenant_id: currentTenant.id,
        p_filters: filters as any,
        p_limit: 1000,
        p_offset: 0
      });
      
      if (error) throw error;
      return (data as any).items || [] as LoadControlRow[];
    },
    enabled: !!currentTenant,
  });
}

export function useLoadDocuments(loadId?: string) {
  return useQuery({
    queryKey: ['load-documents', loadId],
    queryFn: async () => {
      if (!loadId) return [];
      const { data, error } = await supabase.from('load_documents').select('*').eq('load_id', loadId);
      if (error) throw error;
      return data;
    },
    enabled: !!loadId,
  });
}

export function useUnloadingCharges(arg: string | { loadId?: string }) {
  const loadId = typeof arg === 'string' ? arg : arg.loadId;
  const { currentTenant } = useTenant();
  
  return useQuery({
    queryKey: ['unloading-charges', currentTenant?.id, loadId],
    queryFn: async () => {
      if (!currentTenant) return [];
      let query = supabase.from('load_unloading_charges').select('*').eq('tenant_id', currentTenant.id);
      if (loadId) {
        query = query.eq('load_id', loadId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as any[] as UnloadingChargeRow[];
    },
    enabled: !!currentTenant,
  });
}

export function useImportBatches() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['import-batches', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('load_import_batches')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });
}

export function useRegisterPayment() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (p: { loadId: string; amount: number; paymentDate: string; method?: string; notes?: string }) => {
      if (!currentTenant) throw new Error('Tenant not found');

      // Use a RPC to ensure transactional updates
      const { error } = await supabase.rpc('update_load_v1', {
        p_tenant_id: currentTenant.id,
        p_load_id: p.loadId,
        p_changes: {
          payment_status: 'paid',
          payment_date: p.paymentDate,
          received_amount: p.amount,
          payment_method: p.method,
          notes: p.notes
        }
      });
      
      if (error) throw error;

      // Also insert into payments table
      const { error: pError } = await supabase.from('load_payments').insert({
        tenant_id: currentTenant.id,
        load_id: p.loadId,
        amount: p.amount,
        payment_date: p.paymentDate,
        payment_method: p.method,
        notes: p.notes,
      });

      if (pError) throw pError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load-control'] });
    },
  });
}

export function useMarkUnpaid() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (loadId: string) => {
      if (!currentTenant) throw new Error('Tenant not found');

      const { error } = await supabase.rpc('update_load_v1', {
        p_tenant_id: currentTenant.id,
        p_load_id: loadId,
        p_changes: { payment_status: 'unpaid', payment_date: null, received_amount: 0 }
      });

      if (error) throw error;

      // Optionally delete related payments? Usually we keep history, so maybe just mark as reversed.
      // For now, following user request for transactional consistency.
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load-control'] });
    },
  });
}

export const commitSpreadsheetImport = async (tenantId: string, fileName: string, parsed: any[]) => {
    // Flatten all rows from all detected sheets
    const rows = parsed.flatMap(p => [...p.summary, ...p.detail, ...p.unloading]);
    
    const { data, error } = await supabase.rpc('commit_load_import_v1', {
        p_tenant_id: tenantId,
        p_file_name: fileName,
        p_source_type: 'spreadsheet',
        p_rows: rows
    });

    if (error) throw error;
    return { preview: data as any };
};

export const commitXmlImport = async (tenantId: string, fileName: string, docs: any[]) => {
    // Map XML docs to import rows
    const rows = docs.map(d => ({
        external_load_number: d.kind === 'cte' ? d.number : d.access_key, // Fallback logic
        load_date: d.issue_date,
        gross_cargo_value: d.kind === 'nfe' ? d.total_value : d.cargo_value,
        freight_amount: d.kind === 'cte' ? d.freight_value : 0,
        legacy_status_text: `Importado via XML (${d.kind})`
    }));

    const { data, error } = await supabase.rpc('commit_load_import_v1', {
        p_tenant_id: tenantId,
        p_file_name: fileName,
        p_source_type: 'xml',
        p_rows: rows
    });

    if (error) throw error;
    return { preview: data as any };
};
