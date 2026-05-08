import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface NFSeDoc {
  id: string;
  tenant_id: string;
  branch_code: string;
  doc_type: string;
  series: string | null;
  rps_number: string | null;
  nfse_number: string | null;
  internal_number: string | null;
  invoice_number: string | null;
  reference_number: string | null;
  pedido: string | null;
  situacao_doc: string | null;
  is_preview: boolean;
  cancelled: boolean;
  issue_date: string;
  cond_pagamento: string | null;
  tipo_ctrc: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  cliente_cnpj: string | null;
  pagador_nome: string | null;
  pagador_cnpj: string | null;
  items: any[];
  description: string | null;
  valor_servicos: number;
  base_calculo: number;
  aliquota_iss: number;
  valor_iss: number;
  valor_liquido: number;
  valor_total: number;
  status: string;
  provider: string | null;
  protocol_number: string | null;
  verification_code: string | null;
  load_id: string | null;
  related_cte_ids: string[] | null;
  pdf_url: string | null;
  xml_url: string | null;
  rejection_messages: any;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useNFSeList(filters?: { status?: string; loadId?: string; clientId?: string }) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['nfse', currentTenant?.id, filters],
    enabled: !!currentTenant,
    queryFn: async () => {
      let q = (supabase as any)
        .from('nfse_documents')
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .order('issue_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);
      if (filters?.status) q = q.eq('status', filters.status);
      if (filters?.loadId) q = q.eq('load_id', filters.loadId);
      if (filters?.clientId) q = q.eq('cliente_id', filters.clientId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as NFSeDoc[];
    },
  });
}

export function useCreateNFSe() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<NFSeDoc> & { branch_code?: string; series?: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const branch = input.branch_code || 'MATRIZ';
      const series = input.series || '1';
      // Allocate next RPS number atomically
      const { data: nextNum, error: numErr } = await (supabase as any).rpc('next_nfse_number', {
        _tenant_id: currentTenant.id,
        _branch_code: branch,
        _series: series,
      });
      if (numErr) throw numErr;
      const payload: any = {
        ...input,
        tenant_id: currentTenant.id,
        branch_code: branch,
        series,
        rps_number: String(nextNum),
        internal_number: String(nextNum),
        status: 'draft',
        created_by: user?.id ?? null,
      };
      const { data, error } = await (supabase as any)
        .from('nfse_documents')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      await (supabase as any).from('nfse_events').insert({
        tenant_id: currentTenant.id,
        nfse_id: data.id,
        event_type: 'created',
        message: `RPS ${nextNum} criado (rascunho)`,
        created_by: user?.id ?? null,
      });
      return data as NFSeDoc;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nfse'] }),
  });
}

export function useUpdateNFSe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<NFSeDoc> }) => {
      const { data, error } = await (supabase as any)
        .from('nfse_documents')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nfse'] }),
  });
}

export function useIssueNFSe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('emit-nfse', {
        body: { action: 'emit', nfse_id: id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['nfse'] });
      if (data?.status === 'issued') toast.success('NFS-e emitida');
      else if (data?.status === 'queued' || data?.simulated) toast.info('Provedor fiscal não configurado — NFS-e marcada como pronta para emissão');
      else if (data?.status === 'rejected') toast.error(`Rejeitada: ${data?.message ?? ''}`);
    },
    onError: (e: any) => toast.error(e?.message || 'Falha ao emitir NFS-e'),
  });
}

export function useCancelNFSe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await supabase.functions.invoke('emit-nfse', {
        body: { action: 'cancel', nfse_id: id, reason },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nfse'] });
      toast.success('Cancelamento registrado');
    },
    onError: (e: any) => toast.error(e?.message || 'Falha ao cancelar NFS-e'),
  });
}

export function useNFSeProviderConfig(branchCode: string = 'MATRIZ') {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['nfse_provider_config', currentTenant?.id, branchCode],
    enabled: !!currentTenant,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('nfse_provider_configs')
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .eq('branch_code', branchCode)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
