import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { validateUpload } from '@/lib/uploadPolicy';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export type ReturnSheetStatus = 'generated' | 'printed' | 'signed' | 'cancelled' | 'superseded';

export interface ReturnSheet {
  id: string;
  tenant_id: string;
  occurrence_id: string;
  sheet_number: string;
  sac_number: string | null;
  status: ReturnSheetStatus;
  version: number;
  superseded_by: string | null;
  company_snapshot: Record<string, unknown>;
  occurrence_snapshot: Record<string, unknown>;
  invoice_snapshot: Array<Record<string, unknown>>;
  product_snapshot: Array<Record<string, unknown>>;
  pdf_url: string | null;
  generated_at: string;
  generated_by: string | null;
  printed_at: string | null;
  signed_at: string | null;
  signed_proof_url: string | null;
  receiver_name: string | null;
  receiver_document: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export const ALLOWED_RESOLUTION_TYPES = [
  'returned_total', 'returned_partial', 'partial_return', 'damaged_before_dispatch',
  'refused_by_customer', 'rejected_invoice', 'shortage_found', 'surplus_found',
  'collection_requested', 'collection_done', 'order_divergence', 'inverted_product',
] as const;

export const BLOCKED_STATUSES = [
  'open', 'in_review', 'waiting_client', 'waiting_supplier', 'waiting_driver', 'cancelled',
];

export function canGenerateReturnSheet(occurrence: {
  status?: string | null;
  resolution_type?: string | null;
} | null | undefined): { ok: boolean; reason?: string } {
  if (!occurrence) return { ok: false, reason: 'Ocorrência não encontrada' };
  if (occurrence.status === 'cancelled') return { ok: false, reason: 'Ocorrência cancelada' };
  if (!occurrence.status || !['resolved', 'closed'].includes(occurrence.status)) {
    return { ok: false, reason: 'Finalize a tratativa da ocorrência antes de gerar a folha de devolução.' };
  }
  if (!occurrence.resolution_type) return { ok: false, reason: 'Solução não definida' };
  if (!(ALLOWED_RESOLUTION_TYPES as readonly string[]).includes(occurrence.resolution_type)) {
    return { ok: false, reason: `Solução "${occurrence.resolution_type}" não permite folha de devolução` };
  }
  return { ok: true };
}

export function useReturnSheetsForOccurrence(occurrenceId: string | null | undefined) {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id ?? null;
  return useQuery({
    queryKey: ['occurrence-return-sheets', tenantId, occurrenceId],
    enabled: !!tenantId && !!occurrenceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('occurrence_return_sheets')
        .select('*')
        .eq('tenant_id', tenantId!)
        .eq('occurrence_id', occurrenceId!)
        .order('version', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ReturnSheet[];
    },
  });
}

export interface ReturnSheetListFilters {
  status?: ReturnSheetStatus | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  search?: string | null;
}

export function useReturnSheets(filters: ReturnSheetListFilters = {}) {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id ?? null;
  return useQuery({
    queryKey: ['occurrence-return-sheets-list', tenantId, filters],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from('occurrence_return_sheets')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('generated_at', { ascending: false })
        .limit(500);
      if (filters.status) q = q.eq('status', filters.status);
      if (filters.periodStart) q = q.gte('generated_at', filters.periodStart);
      if (filters.periodEnd) q = q.lte('generated_at', filters.periodEnd);
      if (filters.search) q = q.ilike('sheet_number', `%${filters.search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ReturnSheet[];
    },
  });
}

export function useGenerateReturnSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { occurrenceId: string; regenerate?: boolean; reason?: string | null }) => {
      const { data, error } = await supabase.rpc('generate_occurrence_return_sheet', {
        _occurrence_id: params.occurrenceId,
        _regenerate: params.regenerate ?? false,
        _regeneration_reason: params.reason ?? null,
      });
      if (error) throw error;
      return data as { return_sheet_id: string; sheet_number: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['occurrence-return-sheets'] });
      qc.invalidateQueries({ queryKey: ['occurrence-return-sheets-list'] });
    },
  });
}

export function useCancelReturnSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { returnSheetId: string; reason: string }) => {
      const { error } = await supabase.rpc('cancel_occurrence_return_sheet', {
        _return_sheet_id: params.returnSheetId,
        _reason: params.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['occurrence-return-sheets'] });
      qc.invalidateQueries({ queryKey: ['occurrence-return-sheets-list'] });
    },
  });
}

export function useMarkReturnSheetPrinted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (returnSheetId: string) => {
      const { error } = await supabase
        .from('occurrence_return_sheets')
        .update({ status: 'printed', printed_at: new Date().toISOString() })
        .eq('id', returnSheetId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['occurrence-return-sheets'] });
      qc.invalidateQueries({ queryKey: ['occurrence-return-sheets-list'] });
    },
  });
}

export function useUploadSignedProof() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (params: {
      returnSheetId: string;
      file: File;
      receiverName?: string | null;
      receiverDocument?: string | null;
    }) => {
      if (!currentTenant?.id) throw new Error('tenant');
      const { contentType, safeName } = validateUpload(params.file, 'proof');
      const path = `${currentTenant.id}/${params.returnSheetId}-${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      const up = await supabase.storage
        .from('occurrence-return-proofs')
        .upload(path, params.file, { upsert: true, contentType });
      if (up.error) throw up.error;
      const { error } = await supabase
        .from('occurrence_return_sheets')
        .update({
          status: 'signed',
          signed_at: new Date().toISOString(),
          signed_proof_url: path,
          receiver_name: params.receiverName ?? null,
          receiver_document: params.receiverDocument ?? null,
        })
        .eq('id', params.returnSheetId);
      if (error) throw error;

      // history
      const { data: sheet } = await supabase
        .from('occurrence_return_sheets')
        .select('tenant_id, occurrence_id')
        .eq('id', params.returnSheetId)
        .maybeSingle();
      if (sheet) {
        await supabase.from('occurrence_return_sheet_history').insert({
          tenant_id: sheet.tenant_id,
          return_sheet_id: params.returnSheetId,
          occurrence_id: sheet.occurrence_id,
          action: 'signed_proof_uploaded',
          metadata: { path },
          created_by: user?.id ?? null,
        });
      }
      return path;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['occurrence-return-sheets'] });
      qc.invalidateQueries({ queryKey: ['occurrence-return-sheets-list'] });
    },
  });
}

export async function getSignedProofUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('occurrence-return-proofs')
    .createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export function useReturnSheetHistory(returnSheetId: string | null | undefined) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['occurrence-return-sheets-history', returnSheetId],
    enabled: !!returnSheetId && !!currentTenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('occurrence_return_sheet_history')
        .select('*')
        .eq('return_sheet_id', returnSheetId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}