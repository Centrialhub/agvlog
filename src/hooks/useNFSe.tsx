import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import { buildNFSeEmitPayload } from '@/lib/fiscal/nfseBuilder';

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
    mutationFn: async (input: Partial<NFSeDoc> & { branch_code?: string; series?: string; emitter_id?: string | null }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const series = input.series || '1';

      // Resolve emitter: explicit → default active
      let emitterId = input.emitter_id ?? null;
      let branch = input.branch_code || 'MATRIZ';
      if (!emitterId) {
        const { data: def } = await (supabase as any)
          .from('tenant_emitters').select('id, branch_code')
          .eq('tenant_id', currentTenant.id).eq('is_default', true).eq('active', true).maybeSingle();
        if (def?.id) { emitterId = def.id; branch = def.branch_code || branch; }
      } else {
        const { data: em } = await (supabase as any)
          .from('tenant_emitters').select('branch_code').eq('id', emitterId).maybeSingle();
        if (em?.branch_code) branch = em.branch_code;
      }

      // Allocate next RPS number atomically (prefer per-emitter, fallback to per-branch)
      let nextNum: any;
      if (emitterId) {
        const { data, error } = await (supabase as any).rpc('next_nfse_number_by_emitter', {
          _tenant_id: currentTenant.id, _emitter_id: emitterId, _series: series,
        });
        if (error) throw error;
        nextNum = data;
      } else {
        const { data, error } = await (supabase as any).rpc('next_nfse_number', {
          _tenant_id: currentTenant.id, _branch_code: branch, _series: series,
        });
        if (error) throw error;
        nextNum = data;
      }
      const payload: any = {
        ...input,
        tenant_id: currentTenant.id,
        emitter_id: emitterId,
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
      // 1. Carrega o documento e o emitente vinculado.
      const { data: doc, error: dErr } = await (supabase as any)
        .from('nfse_documents')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (dErr) throw dErr;
      if (!doc) throw new Error('NFS-e não encontrada');

      let emitter: any = null;
      if (doc.emitter_id) {
        const { data: em } = await (supabase as any)
          .from('tenant_emitters')
          .select('*')
          .eq('id', doc.emitter_id)
          .maybeSingle();
        emitter = em;
      }

      // 2. Se há emitente com credencial Hub Fiscal, roteia pelo proxy.
      let hasHubCred = false;
      if (emitter) {
        const { data: creds } = await (supabase as any)
          .from('hub_fiscal_credentials')
          .select('id, doc_scope')
          .eq('emitter_id', emitter.id)
          .eq('enabled', true)
          .in('doc_scope', ['nfse', 'all']);
        hasHubCred = (creds || []).length > 0;
      }

      if (hasHubCred && emitter) {
        const environment = (emitter?.metadata?.environment as 'production' | 'sandbox') || 'production';
        const built = buildNFSeEmitPayload({ doc, emitter, environment });
        const res = await hubFiscal.emit({
          type: 'nfse',
          emitterId: emitter.id,
          nfseDocumentId: doc.id,
          body: {
            emitterCnpj: built.emitterCnpj,
            environment: built.environment,
            externalId: built.externalId,
            payload: built.payload,
          },
        });

        const hubDoc = (res as any)?.hub?.document || {};
        const emission = (res as any)?.emission || {};
        // Normaliza status devolvido pelo Hub para o vocabulário local.
        const rawStatus = String(hubDoc.status || hubDoc.plugnotasStatus || '').toLowerCase();
        const isAuthorized = ['authorized', 'autorizado', 'concluido', 'issued'].includes(rawStatus);
        const isRejected = ['rejected', 'rejeitado', 'erro', 'error'].includes(rawStatus);
        const localStatus = !res.success
          ? 'rejected'
          : isAuthorized
            ? 'issued'
            : isRejected
              ? 'rejected'
              : (rawStatus || 'processing');
        await (supabase as any).from('nfse_documents').update({
          status: localStatus,
          provider: 'hub_fiscal',
          protocol_number: hubDoc.authorizationProtocol || hubDoc.plugnotasProtocol || null,
          nfse_number: hubDoc.number || null,
          verification_code: hubDoc.accessKey || null,
          pdf_url: hubDoc.pdfUrl || null,
          xml_url: hubDoc.xmlUrl || null,
          authorization_date: isAuthorized ? new Date().toISOString() : null,
          rejection_messages: isRejected
            ? { message: hubDoc.message || (res as any)?.hub?.error?.message || 'Rejeitada' }
            : null,
        }).eq('id', doc.id);
        await (supabase as any).from('nfse_events').insert({
          tenant_id: doc.tenant_id,
          nfse_id: doc.id,
          event_type: !res.success ? 'rejected' : isAuthorized ? 'issued' : 'submitted',
          message: !res.success
            ? `Falha Hub Fiscal: ${(res as any)?.hub?.error?.message || (res as any)?.error?.message || 'erro'}`
            : isAuthorized
              ? `Autorizada pelo Hub Fiscal — nº ${hubDoc.number || '(pendente)'}`
              : `Enviado ao Hub Fiscal (emitente ${emitter.cnpj}) — ${rawStatus || 'processing'}`,
          payload: { hub: (res as any)?.hub, emission_id: emission.id },
        });
        if (!res.success) {
          throw new Error((res as any)?.hub?.error?.message || (res as any)?.error?.message || 'Falha ao enviar ao Hub Fiscal');
        }
        return { status: localStatus, provider: 'hub_fiscal', hub: (res as any)?.hub };
      }

      // 3. Fallback: sem credencial Hub Fiscal → caminho legado (simulação / provedor local).
      const { data, error } = await supabase.functions.invoke('emit-nfse', {
        body: { action: 'emit', nfse_id: id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['nfse'] });
      if (data?.status === 'issued') toast.success('NFS-e emitida');
      else if (data?.provider === 'hub_fiscal' && data?.status === 'processing') toast.info('NFS-e enviada ao Hub Fiscal — aguardando autorização da prefeitura');
      else if (data?.provider === 'hub_fiscal') toast.success(`NFS-e no Hub Fiscal — ${data.status}`);
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
      // Se já foi emitido pelo Hub Fiscal, cancela pelo proxy (per-emitente).
      const { data: doc } = await (supabase as any)
        .from('nfse_documents')
        .select('id, tenant_id, emitter_id, provider, protocol_number, status')
        .eq('id', id)
        .maybeSingle();

      if (doc?.provider === 'hub_fiscal' && doc?.emitter_id) {
        // Recupera hub_document_id da emissão mais recente.
        const { data: em } = await (supabase as any)
          .from('hub_fiscal_emissions')
          .select('id, hub_document_id')
          .eq('nfse_document_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (em?.hub_document_id) {
          const justif = (reason || '').padEnd(15, ' ');
          const res = await hubFiscal.cancel(em.hub_document_id, justif, em.id);
          if (!res.success) throw new Error((res as any)?.hub?.error?.message || 'Falha ao cancelar no Hub Fiscal');
          await (supabase as any).from('nfse_documents').update({
            status: 'cancelled', cancelled: true,
            cancellation_date: new Date().toISOString(),
            cancellation_reason: reason ?? null,
          }).eq('id', id);
          await (supabase as any).from('nfse_events').insert({
            tenant_id: doc.tenant_id, nfse_id: id,
            event_type: 'cancelled',
            message: `Cancelada no Hub Fiscal — ${reason || ''}`,
          });
          return { status: 'cancelled', provider: 'hub_fiscal' };
        }
      }

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
