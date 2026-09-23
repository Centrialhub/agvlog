import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { Database, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import {fetchAllPostgrestPages} from '@/lib/supabase/fetchAllPages';

export type EdiStatus = 'not_generated' | 'generated' | 'downloaded' | 'sent' | 'error';
export type ExportStatus = 'draft' | 'generated' | 'downloaded' | 'sent' | 'cancelled' | 'error';

export type EdiProfile = Tables<'billing_edi_profiles'>;
export type EdiProfileDraft = Partial<Omit<TablesInsert<'billing_edi_profiles'>, 'name' | 'tenant_id'>> & {
  name: string;
};

export type EdiExport = Omit<Tables<'billing_edi_exports'>, 'status'> & { status: ExportStatus };
export const EDI_HISTORY_PAGE_SIZE = 30;
export const EDI_ELIGIBLE_PAGE_SIZE = 50;

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
      return await fetchAllPostgrestPages((from,to)=>supabase
        .from('billing_edi_profiles').select('*').eq('tenant_id', currentTenant!.id)
        .order('name').order('id').range(from,to)) as unknown as EdiProfile[];
    },
  });
}

export function useEdiExports(page = 1) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['edi_exports', currentTenant?.id, page],
    enabled: !!currentTenant,
    queryFn: async () => {
      const from=(page-1)*EDI_HISTORY_PAGE_SIZE,to=from+EDI_HISTORY_PAGE_SIZE-1;
      const {data,error,count}=await supabase.from('billing_edi_exports')
        .select('id, tenant_id, profile_id, client_id, format, file_name, file_date, generated_at, generated_by, invoice_count, charge_count, detail_count, record_count, total_amount, status, content_hash, storage_path, sent_at, sent_to, sent_channel, downloaded_at, cancelled_at, cancellation_reason, reprocess_reason, error_message, created_at, updated_at',{count:'exact'})
        .eq('tenant_id', currentTenant!.id).order('generated_at', { ascending: false }).order('id').range(from,to);
      if(error)throw error;
      return {rows:(data??[]) as unknown as EdiExport[],total:count??0};
    },
  });
}

export async function fetchEdiExportContent(tenantId:string,exportId:string){
  const {data,error}=await supabase.from('billing_edi_exports').select('generated_content').eq('tenant_id',tenantId).eq('id',exportId).maybeSingle();
  if(error)throw error;
  if(!data?.generated_content)throw new Error('Arquivo sem conteúdo persistido');
  return data.generated_content;
}

/** Faturas elegíveis para DOCCOB. */
export interface EdiFilters {
  clientId?: string | null;
  ediStatus?: 'all' | 'generated' | 'not_generated';
  issueFrom?: string | null;
  issueTo?: string | null;
  dueFrom?: string | null;
  dueTo?: string | null;
  enabled?: boolean;
}

export function useEligibleInvoicesForEdi(filters: EdiFilters, page = 1) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['edi_eligible_invoices', currentTenant?.id, filters, page],
    enabled: !!currentTenant && filters.enabled !== false,
    queryFn: async () => {
      let q = supabase
        .from('client_invoices')
        .select('id, invoice_number, client_id, issue_date, due_date, total_amount, status, edi_status, clients(company_name, tax_id)',{count:'exact'})
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
      const from=(page-1)*EDI_ELIGIBLE_PAGE_SIZE,to=from+EDI_ELIGIBLE_PAGE_SIZE-1;
      const {data,error,count}=await q.order('issue_date', { ascending: false }).order('id').range(from,to);
      if(error)throw error;
      return {rows:(data??[]) as unknown as EligibleInvoice[],total:count??0};
    },
  });
}

/** Carrega charges + details de várias faturas de uma vez. */
export async function fetchInvoicesBundle(tenantId: string, invoiceIds: string[]) {
  if (invoiceIds.length === 0) return { invoices: [], charges: [], details: [] };
  const chunks:Array<string[]>=[];for(let index=0;index<invoiceIds.length;index+=100)chunks.push(invoiceIds.slice(index,index+100));
  const parts=await Promise.all(chunks.map(async ids=>{const [invoices,charges,details]=await Promise.all([
    fetchAllPostgrestPages((from,to)=>supabase.from('client_invoices').select('*, clients(company_name, tax_id)').eq('tenant_id', tenantId).in('id', ids).order('id').range(from,to)),
    fetchAllPostgrestPages((from,to)=>supabase.from('client_invoice_charges').select('*').eq('tenant_id', tenantId).in('invoice_id', ids).is('cancelled_at', null).order('id').range(from,to)),
    fetchAllPostgrestPages((from,to)=>supabase.from('client_invoice_details').select('*').eq('tenant_id', tenantId).in('invoice_id', ids).order('id').range(from,to)),
  ]);return{invoices,charges,details};}));
  const inv=parts.flatMap(part=>part.invoices),charges=parts.flatMap(part=>part.charges),details=parts.flatMap(part=>part.details);
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
      const reason = input.reason.trim();
      if (reason.length < 5 || reason.length > 1000) throw new Error('Informe um motivo de cancelamento entre 5 e 1000 caracteres.');
      const { error } = await supabase.rpc('cancel_doccob_export', {
        _tenant_id: currentTenant!.id,
        _export_id: input.exportId,
        _reason: reason,
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
      if (!currentTenant) throw new Error('Tenant ativo não encontrado.');
      const source = payload as Partial<EdiProfile>;
      const { id, updated_at: expectedUpdatedAt, tenant_id: _tenantId, created_at: _createdAt, created_by: _createdBy, ...editable } = source;
      const query = id
        ? supabase.from('billing_edi_profiles').update(editable as TablesUpdate<'billing_edi_profiles'>)
          .eq('id', id).eq('tenant_id', currentTenant.id).eq('updated_at', expectedUpdatedAt ?? '').select().maybeSingle()
        : supabase.from('billing_edi_profiles').insert({ ...editable, name: payload.name, tenant_id: currentTenant.id } as TablesInsert<'billing_edi_profiles'>).select().maybeSingle();
      const { data, error } = await query;
      if (error) throw error;
      if (!data) throw new Error('O perfil foi alterado por outra pessoa. Recarregue os perfis e tente novamente.');
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edi_profiles'] }),
  });
}
