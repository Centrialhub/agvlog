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
  insurer_name?: string | null;
  insurer_cnpj?: string | null;
  insurer_policy?: string | null;
  insurer_endorsement?: string | null;
  insured_amount?: number | null;
  insurance_premium?: number | null;
  regime_tributario?: string | null;
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

/**
 * Mapa `nfse_document_id -> { hub_document_id, emission_id }` a partir da emissão
 * mais recente de cada nota. Necessário para baixar PDF/XML sob demanda no Hub.
 */
export async function fetchNfseHubRefs(ids: string[]) {
  const refs = new Map<string, { hubDocumentId: string; emissionId: string }>();
  if (ids.length === 0) return refs;
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data, error } = await (supabase as any)
      .from('hub_fiscal_emissions')
      .select('id, hub_document_id, nfse_document_id, created_at')
      .in('nfse_document_id', slice)
      .order('created_at', { ascending: true });
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.hub_document_id && row.nfse_document_id) {
        // ordem crescente: a última atribuição fica sendo a emissão mais recente
        refs.set(row.nfse_document_id, { hubDocumentId: row.hub_document_id, emissionId: row.id });
      }
    }
  }
  return refs;
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
      let regime = (input as any).regime_tributario || null;

      if (!emitterId) {
        const { data: def } = await (supabase as any)
          .from('tenant_emitters').select('id, branch_code, regime_tributario')
          .eq('tenant_id', currentTenant.id).eq('is_default', true).eq('active', true).maybeSingle();
        if (def?.id) { 
          emitterId = def.id; 
          branch = def.branch_code || branch; 
          regime = regime || def.regime_tributario || null;
        }
      } else {
        const { data: em } = await (supabase as any)
          .from('tenant_emitters').select('branch_code, regime_tributario').eq('id', emitterId).maybeSingle();
        if (em?.branch_code) branch = em.branch_code;
        regime = regime || em?.regime_tributario || null;
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
        regime_tributario: regime,
        branch_code: branch,
        series,
        rps_number: String(nextNum),
        internal_number: String(nextNum),
        status: 'draft',
        created_by: user?.id ?? null,
      };

      // Propaga o seguro das NFs vinculadas quando não informado no formulário,
      // garantindo que CT-e e NFS-e saiam com exatamente os mesmos dados.
      const linkedIds = (input as any).fiscal_document_ids as string[] | undefined;
      const hasManualInsurance = !!(
        payload.insurer_name || payload.insurer_cnpj || payload.insurer_policy || payload.insurer_endorsement
      );
      if (!hasManualInsurance && linkedIds?.length) {
        const { data: srcs } = await (supabase as any)
          .from('fiscal_documents')
          .select('insurer_name, insurer_cnpj, insurer_policy, insurer_endorsement, insured_amount, insurance_premium')
          .in('id', linkedIds)
          .eq('tenant_id', currentTenant.id);
        const src = (srcs ?? []).find((d: any) => d?.insurer_policy || d?.insurer_name || d?.insurer_cnpj);
        if (src) {
          payload.insurer_name = src.insurer_name ?? null;
          payload.insurer_cnpj = src.insurer_cnpj ?? null;
          payload.insurer_policy = src.insurer_policy ?? null;
          payload.insurer_endorsement = src.insurer_endorsement ?? null;
          payload.insured_amount = (srcs ?? []).reduce((a: number, d: any) => a + Number(d?.insured_amount || 0), 0) || null;
          payload.insurance_premium = (srcs ?? []).reduce((a: number, d: any) => a + Number(d?.insurance_premium || 0), 0) || null;
        }
      }

      const { data, error } = await (supabase as any)
        .from('nfse_documents')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      // Vincula as NFs escolhidas para gerar a NFS-e — a mesma regra do CT-e:
      // uma NF de entrada só pode virar UM documento de saída.
      const fdIds = (input as any).fiscal_document_ids as string[] | undefined;
      if (fdIds && fdIds.length) {
        await (supabase as any)
          .from('fiscal_documents')
          .update({ nfse_emitted_at: new Date().toISOString(), nfse_emitted_document_id: data.id })
          .in('id', fdIds)
          .eq('tenant_id', currentTenant.id);
      }
      await (supabase as any).from('nfse_events').insert({
        tenant_id: currentTenant.id,
        nfse_id: data.id,
        event_type: 'created',
        message: `RPS ${nextNum} criado (rascunho)`,
        created_by: user?.id ?? null,
      });
      return data as NFSeDoc;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nfse'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    },
  });
}

export function useUpdateNFSe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<NFSeDoc> }) => {
      // Se a atualização mudou o conjunto de NFs vinculadas, sincroniza flags nas NFs.
      const fdIds = (patch as any).fiscal_document_ids as string[] | undefined;
      const { data, error } = await (supabase as any)
        .from('nfse_documents')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      if (fdIds) {
        // Libera NFs previamente vinculadas a esta NFS-e que não estão mais na lista
        await (supabase as any)
          .from('fiscal_documents')
          .update({ nfse_emitted_at: null, nfse_emitted_document_id: null })
          .eq('nfse_emitted_document_id', id)
          .not('id', 'in', `(${fdIds.length ? fdIds.map((x) => `"${x}"`).join(',') : '""'})`);
        if (fdIds.length) {
          await (supabase as any)
            .from('fiscal_documents')
            .update({ nfse_emitted_at: new Date().toISOString(), nfse_emitted_document_id: id })
            .in('id', fdIds);
        }
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nfse'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    },
  });
}

export function useIssueNFSe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const deepHubError = (res: any): string | null => {
        const doc = res?.hub?.document || {};
        return (
          doc?.raw_response_json?.error?.message ||
          doc?.raw_response_json?.message ||
          res?.hub?.error?.message ||
          doc?.message ||
          res?.error?.message ||
          null
        );
      };
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
        // Reenvio: o Hub/PlugNotas deduplica pelo idIntegracao. Contamos as
        // tentativas anteriores para gerar um id novo a cada reenvio, senão a
        // requisição é descartada silenciosamente e nada chega ao provedor.
        // Use total emissions count for NFSe/CTe documents to guarantee a fresh idIntegracao
        // even if some attempts failed before registering in hub_fiscal_emissions (due to 503).
        const { count: priorAttempts } = await (supabase as any)
          .from('hub_fiscal_emissions')
          .select('id', { count: 'exact', head: true })
          .or(`nfse_document_id.eq.${doc.id},cte_document_id.eq.${doc.id},fiscal_document_id.eq.${doc.id}`);

        const built = buildNFSeEmitPayload({
          doc,
          emitter,
          environment,
          attempt: (priorAttempts || 0),
        });
        console.log(`[useIssueNFSe] Transmitindo NFS-e ${doc.id} (emitter: ${emitter.id})`, { priorAttempts });
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
        console.log(`[useIssueNFSe] Resposta do Hub:`, res);

        const hubDoc = (res as any)?.hub?.document || {};
        const emission = (res as any)?.emission || {};
        // Normaliza status devolvido pelo Hub para o vocabulário local.
        const rawStatus = String(hubDoc.status || hubDoc.plugnotasStatus || '').toLowerCase();
        const isAuthorized = ['authorized', 'autorizado', 'concluido', 'issued'].includes(rawStatus);
        const isRejected = ['rejected', 'rejeitado', 'erro', 'error'].includes(rawStatus);
        const hubErrorMessage = deepHubError(res);

        // Se o Hub retornar sucesso na requisição mas o status for rascunho/vazio, 
        // assumimos 'submitted' (processando) em vez de manter 'draft'.
        const localStatus = !res.success
          ? 'rejected'
          : isAuthorized
            ? 'issued'
            : isRejected
              ? 'rejected'
              : 'submitted'; // Força saída de 'draft' se o Hub aceitou a nota
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
            ? { message: hubErrorMessage || 'Rejeitada' }
            : null,
        }).eq('id', doc.id);
        await (supabase as any).from('nfse_events').insert({
          tenant_id: doc.tenant_id,
          nfse_id: doc.id,
          event_type: !res.success ? 'rejected' : isAuthorized ? 'issued' : 'submitted',
          message: !res.success
            ? `Falha na validação do JSON de NFSe: ${hubErrorMessage || 'erro'}`
            : isAuthorized
              ? `Autorizada pelo Hub Fiscal — nº ${hubDoc.number || '(pendente)'}`
              : isRejected
                ? `Rejeitada pelo Hub Fiscal: ${hubErrorMessage || 'sem detalhe'}`
                : `Enviado ao Hub Fiscal (emitente ${emitter.cnpj}) — ${rawStatus || 'processing'}`,
          payload: { hub: (res as any)?.hub, emission_id: emission.id },
        });
        if (!res.success || isRejected) {
          throw new Error(hubErrorMessage || 'Falha ao enviar ao Hub Fiscal');
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
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      if (data?.status === 'issued') toast.success('NFS-e autorizada com sucesso!');
      else if (data?.status === 'submitted' || (data?.provider === 'hub_fiscal' && data?.status === 'processing')) {
        toast.info('NFS-e enviada ao Hub Fiscal — aguardando processamento da prefeitura', {
          description: 'Acompanhe o status no Monitor de NFS-e.',
          duration: 5000,
        });
      } else if (data?.provider === 'hub_fiscal') {
        toast.success(`NFS-e no Hub Fiscal — Status: ${data.status}`);
      }
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
          const res = await hubFiscal.cancelNFSe(em.hub_document_id, justif, em.id);
          if (!res.success) {
            const hubMsg = (res as any)?.hub?.error?.message || (res as any)?.hub?.document?.message;
            throw new Error(hubMsg || 'Falha ao cancelar no Hub Fiscal');
          }
          await (supabase as any).from('nfse_documents').update({
            status: 'cancelled', cancelled: true,
            cancellation_date: new Date().toISOString(),
            cancellation_reason: reason ?? null,
          }).eq('id', id);
          // Libera as NFs vinculadas — voltam a aparecer para novo faturamento
          await (supabase as any)
            .from('fiscal_documents')
            .update({ nfse_emitted_at: null, nfse_emitted_document_id: null })
            .eq('nfse_emitted_document_id', id);
          await (supabase as any).from('nfse_events').insert({
            tenant_id: doc.tenant_id, nfse_id: id,
            event_type: 'cancelled',
            message: `Cancelada no Hub Fiscal — ${reason || ''}`,
          });
          return { status: 'cancelled', provider: 'hub_fiscal' };
        }
      }

      // Sem emissão no Hub (rascunho, rejeitada, erro): cancela localmente e libera as NFs.
      if (!doc || doc.status !== 'issued') {
        await (supabase as any).from('nfse_documents').update({
          status: 'cancelled', cancelled: true,
          cancellation_date: new Date().toISOString(),
          cancellation_reason: reason ?? null,
        }).eq('id', id);
        await (supabase as any)
          .from('fiscal_documents')
          .update({ nfse_emitted_at: null, nfse_emitted_document_id: null })
          .eq('nfse_emitted_document_id', id);
        if (doc?.tenant_id) {
          await (supabase as any).from('nfse_events').insert({
            tenant_id: doc.tenant_id, nfse_id: id,
            event_type: 'cancelled',
            message: `Cancelada localmente — ${reason || ''}`,
          });
        }
        return { status: 'cancelled', provider: 'local' };
      }

      const { data, error } = await supabase.functions.invoke('emit-nfse', {
        body: { action: 'cancel', nfse_id: id, reason },
      });
      if (error) throw error;
      // Fallback legado: também libera NFs vinculadas
      await (supabase as any)
        .from('fiscal_documents')
        .update({ nfse_emitted_at: null, nfse_emitted_document_id: null })
        .eq('nfse_emitted_document_id', id);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nfse'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      toast.success('Cancelamento registrado');
    },
    onError: (e: any) => toast.error(e?.message || 'Falha ao cancelar NFS-e'),
  });
}

/** Exclui definitivamente uma NFS-e que não foi autorizada, liberando as NFs vinculadas. */
export function useDeleteNFSe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: doc } = await (supabase as any)
        .from('nfse_documents')
        .select('id, status')
        .eq('id', id)
        .maybeSingle();
      if (doc && ['issued', 'authorized'].includes(doc.status)) {
        throw new Error('NFS-e autorizada não pode ser excluída — cancele primeiro');
      }
      // Libera NFs vinculadas antes de remover o documento
      await (supabase as any)
        .from('fiscal_documents')
        .update({ nfse_emitted_at: null, nfse_emitted_document_id: null })
        .eq('nfse_emitted_document_id', id);
      await (supabase as any).from('nfse_events').delete().eq('nfse_id', id);
      const { error } = await (supabase as any).from('nfse_documents').delete().eq('id', id);
      if (error) throw error;
      return { id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nfse'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      toast.success('NFS-e excluída — NFs liberadas para novo faturamento');
    },
    onError: (e: any) => toast.error(e?.message || 'Falha ao excluir NFS-e'),
  });
}

/**
 * Consulta o status das NFS-e que ficaram "processando" no provedor.
 * Sem argumento, verifica todas as pendentes do tenant; com `id`, apenas uma.
 * A resposta bruta do provedor fica gravada em `nfse_documents.last_status_response`
 * e no histórico de `hub_fiscal_emissions` para conferência posterior.
 */
export function useSyncNFSeStatus() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args?: { id?: string; silent?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('nfse-status-poll', {
        body: args?.id ? { nfse_id: args.id } : { tenant_id: currentTenant?.id },
      });
      if (error) throw error;
      return { ...(data as any), silent: args?.silent };
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['nfse'] });
      if (res?.silent) return;
      const resolved = (res?.results || []).filter((r: any) => r.outcome && r.outcome !== 'pending').length;
      if (resolved > 0) toast.success(`${resolved} NFS-e com status atualizado`);
      else toast.info(`Consulta concluída — ${res?.checked ?? 0} nota(s) ainda em processamento`);
    },
    onError: (e: any) => toast.error(e?.message || 'Falha ao consultar status das NFS-e'),
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
