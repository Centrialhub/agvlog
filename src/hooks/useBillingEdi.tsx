import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export type EdiStatus = 'not_generated' | 'generated' | 'downloaded' | 'sent' | 'error';
export type ExportStatus = 'draft' | 'generated' | 'downloaded' | 'sent' | 'cancelled' | 'error';

export interface EdiProfile {
  id: string;
  tenant_id: string;
  client_id: string | null;
  name: string;
  format: string;
  enabled: boolean;
  company_code: string | null;
  branch_code: string | null;
  document_type: string | null;
  destination_name: string | null;
  bank_name: string | null;
  bank_agency: string | null;
  bank_account: string | null;
  api_integration_id: string | null;
  file_name_pattern: string | null;
  layout_version: string | null;
  metadata: Record<string, any>;
}

export interface EdiExport {
  id: string;
  tenant_id: string;
  profile_id: string | null;
  client_id: string | null;
  format: string;
  file_name: string;
  file_date: string;
  status: ExportStatus;
  invoice_count: number;
  charge_count: number;
  detail_count: number;
  record_count: number;
  total_amount: number;
  content_hash: string | null;
  generated_content: string | null;
  generated_at: string;
  generated_by: string | null;
  downloaded_at: string | null;
  sent_at: string | null;
  sent_channel: string | null;
  sent_to: string | null;
  error_message: string | null;
  reprocess_reason: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

export interface EligibleInvoice {
  id: string;
  invoice_number: string;
  client_id: string;
  issue_date: string;
  due_date: string | null;
  total_amount: number;
  status: string;
  edi_status: EdiStatus;
  clients?: { company_name: string; tax_id: string | null } | null;
}

export function useEdiProfiles() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['edi_profiles', currentTenant?.id],
    enabled: !!currentTenant,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_edi_profiles' as any)
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .order('name');
      if (error) throw error;
      return (data || []) as unknown as EdiProfile[];
    },
  });
}

export function useEdiExports() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['edi_exports', currentTenant?.id],
    enabled: !!currentTenant,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_edi_exports' as any)
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .order('generated_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as unknown as EdiExport[];
    },
  });
}

/** Faturas elegíveis para DOCCOB. */
export interface EdiFilters {
  clientId?: string | null;
  ediStatus?: 'all' | 'generated' | 'not_generated';
  issueFrom?: string | null;
  issueTo?: string | null;
  dueFrom?: string | null;
  dueTo?: string | null;
}

export function useEligibleInvoicesForEdi(filters: EdiFilters) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['edi_eligible_invoices', currentTenant?.id, filters],
    enabled: !!currentTenant,
    queryFn: async () => {
      let q = supabase
        .from('client_invoices')
        .select('id, invoice_number, client_id, issue_date, due_date, total_amount, status, edi_status, clients(company_name, tax_id)')
        .eq('tenant_id', currentTenant!.id)
        .in('status', ['generated', 'sent', 'paid'])
        .order('issue_date', { ascending: false })
        .limit(500);
      if (filters.clientId) q = q.eq('client_id', filters.clientId);
      if (filters.ediStatus && filters.ediStatus !== 'all') {
        q = filters.ediStatus === 'generated'
          ? q.in('edi_status', ['generated', 'sent', 'downloaded'])
          : q.eq('edi_status', 'not_generated');
      }
      if (filters.issueFrom) q = q.gte('issue_date', filters.issueFrom);
      if (filters.issueTo) q = q.lte('issue_date', filters.issueTo);
      if (filters.dueFrom) q = q.gte('due_date', filters.dueFrom);
      if (filters.dueTo) q = q.lte('due_date', filters.dueTo);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as EligibleInvoice[];
    },
  });
}

/** Carrega charges + details de várias faturas de uma vez. */
export async function fetchInvoicesBundle(tenantId: string, invoiceIds: string[]) {
  if (invoiceIds.length === 0) return { invoices: [], charges: [], details: [] };
  const [inv, charges, details] = await Promise.all([
    supabase.from('client_invoices').select('*, clients(company_name, tax_id)').eq('tenant_id', tenantId).in('id', invoiceIds),
    supabase.from('client_invoice_charges').select('*').eq('tenant_id', tenantId).in('invoice_id', invoiceIds).is('cancelled_at', null),
    supabase.from('client_invoice_details').select('*').eq('tenant_id', tenantId).in('invoice_id', invoiceIds),
  ]);
  if (inv.error) throw inv.error;
  if (charges.error) throw charges.error;
  if (details.error) throw details.error;
  return { invoices: inv.data || [], charges: charges.data || [], details: details.data || [] };
}

export function useRegisterEdiExport() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (payload: {
      profileId: string | null;
      clientId: string | null;
      invoiceIds: string[];
      fileName: string;
      fileDate: string;
      generatedContent: string;
      contentHash: string;
      recordCount: number;
      totalAmount: number;
      chargeCount: number;
      detailCount: number;
      reprocessReason?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('register_doccob_export' as any, {
        _tenant_id: currentTenant!.id,
        _profile_id: payload.profileId,
        _client_id: payload.clientId,
        _client_invoice_ids: payload.invoiceIds,
        _file_name: payload.fileName,
        _file_date: payload.fileDate,
        _generated_content: payload.generatedContent,
        _content_hash: payload.contentHash,
        _record_count: payload.recordCount,
        _total_amount: payload.totalAmount,
        _charge_count: payload.chargeCount,
        _detail_count: payload.detailCount,
        _reprocess_reason: payload.reprocessReason ?? null,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edi_exports'] });
      qc.invalidateQueries({ queryKey: ['edi_eligible_invoices'] });
      qc.invalidateQueries({ queryKey: ['client_invoices'] });
    },
  });
}

export function useMarkEdiSent() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (input: { exportId: string; channel?: string; sentTo?: string }) => {
      const { error } = await supabase.rpc('mark_doccob_sent' as any, {
        _tenant_id: currentTenant!.id,
        _export_id: input.exportId,
        _channel: input.channel ?? 'manual',
        _sent_to: input.sentTo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edi_exports'] }),
  });
}

export function useMarkEdiDownloaded() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (exportId: string) => {
      const { error } = await supabase.rpc('mark_doccob_downloaded' as any, {
        _tenant_id: currentTenant!.id,
        _export_id: exportId,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edi_exports'] }),
  });
}

export function useCancelEdiExport() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (input: { exportId: string; reason: string }) => {
      const { error } = await supabase.rpc('cancel_doccob_export' as any, {
        _tenant_id: currentTenant!.id,
        _export_id: input.exportId,
        _reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edi_exports'] });
      qc.invalidateQueries({ queryKey: ['edi_eligible_invoices'] });
      qc.invalidateQueries({ queryKey: ['client_invoices'] });
    },
  });
}

export function useSaveEdiProfile() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (payload: Partial<EdiProfile> & { name: string; client_id?: string | null }) => {
      const row = { ...payload, tenant_id: currentTenant!.id };
      const { data, error } = await supabase
        .from('billing_edi_profiles' as any)
        .upsert(row as any)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edi_profiles'] }),
  });
}