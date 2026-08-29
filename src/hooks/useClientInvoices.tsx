import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables } from '@/integrations/supabase/types';
import type { InvoiceCharge, InvoiceDetail } from '@/lib/clientInvoicePdf';
import { useTenant } from './useTenant';

export const INVOICE_STATUSES = ['draft', 'generated', 'sent', 'paid', 'cancelled'] as const;
export type InvoiceStatus = typeof INVOICE_STATUSES[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Rascunho',
  generated: 'Gerada',
  sent: 'Enviada',
  paid: 'Paga',
  cancelled: 'Cancelada',
};

export interface ClientInvoice {
  id: string;
  tenant_id: string;
  client_id: string;
  invoice_number: string;
  sequence_number: number | null;
  installment_number: number;
  issue_date: string;
  due_date: string | null;
  gross_amount: number;
  discount_amount: number;
  interest_amount: number;
  total_amount: number;
  status: InvoiceStatus | string;
  notes: string | null;
  pdf_url: string | null;
  sent_at: string | null;
  receivable_id: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  clients?: { company_name: string; tax_id?: string | null } | null;
}

export interface ClientInvoiceDetailDraft extends InvoiceDetail {
  source_type?: string;
  source_id?: string;
  document_label?: string;
  notes?: string;
  metadata?: Json;
  sort_order?: number;
}

export interface ClientInvoiceChargeDraft extends InvoiceCharge {
  source_id?: string;
  discount_amount?: number;
  interest_amount?: number;
  ir_amount?: number;
  metadata?: Json;
  sort_order: number;
  details?: ClientInvoiceDetailDraft[];
}

export interface CreateClientInvoicePayload {
  tenant_id: string;
  client_id: string;
  issue_date: string;
  due_date: string | null;
  installment_number?: number;
  discount_amount: number;
  interest_amount: number;
  notes: string | null;
  payer_snapshot?: Json;
  company_snapshot?: Json;
  charges: ClientInvoiceChargeDraft[];
}

export interface ClientInvoiceDetailData {
  invoice: (Tables<'client_invoices'> & { clients: Tables<'clients'> | null }) | null;
  charges: Tables<'client_invoice_charges'>[];
  details: Tables<'client_invoice_details'>[];
}

export function useClientInvoices() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['client_invoices', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [] as ClientInvoice[];
      const { data, error } = await supabase
        .from('client_invoices')
        .select('*, clients(company_name, tax_id)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ClientInvoice[];
    },
    enabled: !!currentTenant,
  });
}

export function useClientInvoiceDetail(invoiceId: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['client_invoice_detail', currentTenant?.id, invoiceId],
    enabled: !!invoiceId && !!currentTenant,
    queryFn: async (): Promise<ClientInvoiceDetailData | null> => {
      const tenantId = currentTenant?.id;
      if (!invoiceId || !tenantId) return null;
      const [inv, charges, details] = await Promise.all([
        supabase.from('client_invoices').select('*, clients(*)').eq('id', invoiceId).eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('client_invoice_charges').select('*').eq('invoice_id', invoiceId).eq('tenant_id', tenantId).order('sort_order'),
        supabase.from('client_invoice_details').select('*').eq('invoice_id', invoiceId).eq('tenant_id', tenantId).order('sort_order'),
      ]);
      if (inv.error) throw inv.error;
      if (charges.error) throw charges.error;
      if (details.error) throw details.error;
      return { invoice: inv.data, charges: charges.data || [], details: details.data || [] };
    },
  });
}

/** CT-e elegíveis para faturamento (não cancelados, não vinculados a fatura ativa) */
export function useEligibleCtes(clientId: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['eligible_ctes', currentTenant?.id, clientId],
    enabled: !!currentTenant && !!clientId,
    queryFn: async () => {
      const tenantId = currentTenant?.id;
      if (!tenantId || !clientId) return [];
      const { data, error } = await supabase
        .from('cte_documents')
        .select('id, cte_number, cte_series, issued_at, freight_value, cargo_value, weight_kg, recipient, remitter, recipient_city, recipient_state, fiscal_document_ids, invoice_numbers, sefaz_status, status, cancelled_at')
        .eq('tenant_id', tenantId)
        .eq('client_id', clientId)
        .is('cancelled_at', null)
        .neq('status', 'cancelled')
        .is('deleted_at', null)
        .order('issued_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const ids = (data || []).map(d => d.id);
      if (ids.length === 0) return [];
      const { data: usedRows, error: usedError } = await supabase
        .from('client_invoice_charges')
        .select('source_id')
        .eq('tenant_id', tenantId)
        .eq('source_type', 'cte_document')
        .in('source_id', ids)
        .is('cancelled_at', null);
      if (usedError) throw usedError;
      const used = new Set((usedRows || []).map(r => r.source_id));
      return (data || []).filter(d => !used.has(d.id));
    },
  });
}

export function useEligibleNfse(clientId: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['eligible_nfse', currentTenant?.id, clientId],
    enabled: !!currentTenant && !!clientId,
    queryFn: async () => {
      const tenantId = currentTenant?.id;
      if (!tenantId || !clientId) return [];
      const { data, error } = await supabase
        .from('nfse_documents')
        .select('id, nfse_number, series, issue_date, valor_total, valor_liquido, valor_ir, description, cliente_nome, cliente_municipio, cliente_uf, reference_number, ctrc_complemento, items, cancelled, status')
        .eq('tenant_id', tenantId)
        .eq('cliente_id', clientId)
        .eq('cancelled', false)
        .neq('status', 'cancelled')
        .is('deleted_at', null)
        .order('issue_date', { ascending: false })
        .limit(500);
      if (error) throw error;
      const ids = (data || []).map(d => d.id);
      if (ids.length === 0) return [];
      const { data: usedRows, error: usedError } = await supabase
        .from('client_invoice_charges')
        .select('source_id')
        .eq('tenant_id', tenantId)
        .eq('source_type', 'nfse_document')
        .in('source_id', ids)
        .is('cancelled_at', null);
      if (usedError) throw usedError;
      const used = new Set((usedRows || []).map(r => r.source_id));
      return (data || []).filter(d => !used.has(d.id));
    },
  });
}

/** Busca fiscal_documents referenciadas por um CT-e para expandir details */
export async function fetchCteFiscalDocs(tenantId: string, fiscalDocIds: string[]) {
  if (!fiscalDocIds?.length) return [];
  const { data, error } = await supabase
    .from('fiscal_documents')
    .select('id, invoice_number, issue_date, recipient, remitter, recipient_city, recipient_state, weight_kg, value')
    .eq('tenant_id', tenantId)
    .in('id', fiscalDocIds)
    .is('deleted_at', null);
  if (error) throw error;
  return data || [];
}

export function useCreateClientInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateClientInvoicePayload) => {
      const { data, error } = await supabase.rpc('create_client_invoice', { payload: payload as unknown as Json });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_invoices'] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['eligible_ctes'] });
      qc.invalidateQueries({ queryKey: ['eligible_nfse'] });
    },
  });
}

export function useCancelClientInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('cancel_client_invoice', { _invoice_id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_invoices'] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['eligible_ctes'] });
      qc.invalidateQueries({ queryKey: ['eligible_nfse'] });
    },
  });
}

export function useMarkInvoiceSent() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, channel, to }: { id: string; channel?: string; to?: string }) => {
      const tenantId = currentTenant?.id;
      if (!tenantId) throw new Error('Tenant ativo não encontrado.');
      const { error } = await supabase.from('client_invoices').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_channel: channel || 'email',
        sent_to: to || null,
      }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client_invoices'] }),
  });
}

export function useMarkInvoicePaid() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, receivable_id }: { id: string; receivable_id?: string | null }) => {
      const tenantId = currentTenant?.id;
      if (!tenantId) throw new Error('Tenant ativo não encontrado.');
      const { error } = await supabase.from('client_invoices').update({ status: 'paid' }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      if (receivable_id) {
        const { error: receivableError } = await supabase.from('receivables').update({
          status: 'received',
          received_at: new Date().toISOString(),
        }).eq('id', receivable_id).eq('tenant_id', tenantId);
        if (receivableError) throw receivableError;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_invoices'] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
    },
  });
}
