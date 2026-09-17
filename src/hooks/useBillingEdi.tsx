import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { Database, Tables, TablesInsert } from '@/integrations/supabase/types';
import {fetchAllPostgrestPages} from '@/lib/supabase/fetchAllPages';

export type EdiStatus = 'not_generated' | 'generated' | 'downloaded' | 'sent' | 'error';
export type ExportStatus = 'draft' | 'generated' | 'downloaded' | 'sent' | 'cancelled' | 'error';

export type EdiProfile = Tables<'billing_edi_profiles'>;
export type EdiProfileDraft = Partial<Omit<TablesInsert<'billing_edi_profiles'>, 'name' | 'tenant_id'>> & {
  name: string;
};

export type EdiExport = Omit<Tables<'billing_edi_exports'>, 'status'> & { status: ExportStatus };

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
        .from('billing_edi_profiles')
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
      return await fetchAllPostgrestPages((from,to)=>supabase.from('billing_edi_exports').select('*')
        .eq('tenant_id', currentTenant!.id).order('generated_at', { ascending: false }).order('id').range(from,to)) as unknown as EdiExport[];
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
      const makeQuery = () => {let q = supabase
        .from('client_invoices')
        .select('id, invoice_number, client_id, issue_date, due_date, total_amount, status, edi_status, clients(company_name, tax_id)')
        .eq('tenant_id', currentTenant!.id)
        .in('status', ['generated', 'sent', 'paid']);
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
      return q.order('issue_date', { ascending: false }).order('id');};
      return await fetchAllPostgrestPages((from,to)=>makeQuery().range(from,to)) as unknown as EligibleInvoice[];
    },
  });
}

/** Carrega charges + details de várias faturas de uma vez. */
export async function fetchInvoicesBundle(tenantId: string, invoiceIds: string[]) {
  if (invoiceIds.length === 0) return { invoices: [], charges: [], details: [] };
  const [inv, charges, details] = await Promise.all([
    fetchAllPostgrestPages((from,to)=>supabase.from('client_invoices').select('*, clients(company_name, tax_id)').eq('tenant_id', tenantId).in('id', invoiceIds).order('id').range(from,to)),
    fetchAllPostgrestPages((from,to)=>supabase.from('client_invoice_charges').select('*').eq('tenant_id', tenantId).in('invoice_id', invoiceIds).is('cancelled_at', null).order('id').range(from,to)),
    fetchAllPostgrestPages((from,to)=>supabase.from('client_invoice_details').select('*').eq('tenant_id', tenantId).in('invoice_id', invoiceIds).order('id').range(from,to)),
  ]);
  if(inv.length!==invoiceIds.length)throw new Error('O conjunto de faturas mudou ou está incompleto. Atualize a seleção.');
  return { invoices: inv, charges, details };
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
      const rpcArgs = {
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
      } as unknown as Database['public']['Functions']['register_doccob_export']['Args'];
      const { data, error } = await supabase.rpc('register_doccob_export', rpcArgs);
      if (error) throw error;
      return data;
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
    mutationFn: async (input: { exportId: string; channel: string; sentTo: string }) => {
      if(!input.channel.trim()||!input.sentTo.trim())throw new Error('Canal e destinatário são obrigatórios para registrar o envio.');
      const { error } = await supabase.rpc('mark_doccob_sent', {
        _tenant_id: currentTenant!.id,
        _export_id: input.exportId,
        _channel: input.channel.trim(),
        _sent_to: input.sentTo.trim(),
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
      const { error } = await supabase.rpc('mark_doccob_downloaded', {
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
      const { error } = await supabase.rpc('cancel_doccob_export', {
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
    mutationFn: async (payload: EdiProfileDraft) => {
      const row = { ...payload, tenant_id: currentTenant!.id };
      const { data, error } = await supabase
        .from('billing_edi_profiles')
        .upsert(row)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edi_profiles'] }),
  });
}
