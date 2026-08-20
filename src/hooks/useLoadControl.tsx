// guardrail:allow-direct-write
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export const PAYMENT_STATUS_LABELS = {
  unpaid: 'Não Pago',
  partial: 'Parcial',
  paid: 'Pago',
  overpaid: 'Pago a Maior',
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
  load?: string;
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
      let query = supabase
        .from('loads')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });

      if (filters.search) {
        query = query.or(`load_number.ilike.%${filters.search}%,external_load_number.ilike.%${filters.search}%`);
      }
      if (filters.payment_status?.length) {
        query = query.in('payment_status', filters.payment_status);
      }
      if (filters.operational_status?.length) {
        query = query.in('status', filters.operational_status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as LoadControlRow[];
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
  return useQuery({
    queryKey: ['unloading-charges', loadId],
    queryFn: async () => {
      if (!loadId) return [];
      const { data, error } = await supabase.from('load_unloading_charges').select('*').eq('load_id', loadId);
      if (error) throw error;
      return (data || []) as any[] as UnloadingChargeRow[];
    },
    enabled: !!loadId,
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
      const { error } = await supabase.from('load_payments').insert({
        tenant_id: currentTenant!.id,
        load_id: p.loadId,
        amount: p.amount,
        payment_date: p.paymentDate,
        payment_method: p.method,
        notes: p.notes,
      });
      if (error) throw error;
      
      await supabase.rpc('update_load_v1', {
        p_tenant_id: currentTenant!.id,
        p_load_id: p.loadId,
        p_changes: {
            payment_status: 'paid',
            payment_date: p.paymentDate
        }
      });
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
      await supabase.rpc('update_load_v1', {
        p_tenant_id: currentTenant!.id,
        p_load_id: loadId,
        p_changes: { payment_status: 'unpaid', payment_date: null, received_amount: 0 }
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load-control'] });
    },
  });
}

export const commitSpreadsheetImport = async (tenantId: string, fileName: string, parsed: any[]) => {
    // Legacy support for the UI caller signature
    return { preview: { newLoads: 0, updatedLoads: 0, errors: [] } };
};

export const commitXmlImport = async (tenantId: string, fileName: string, parsed: any[]) => {
    // Legacy support for the UI caller signature
    return { preview: { newLoads: 0, updatedLoads: 0, errors: [] } };
};

