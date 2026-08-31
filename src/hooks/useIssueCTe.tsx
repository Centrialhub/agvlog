import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import { buildCtePayload, type BuildCtePayloadInput } from '@/lib/fiscal/cteBuilder';
import type { EmitParams } from '@/lib/fiscal/hubFiscalClient';
import type { Json, TablesInsert } from '@/integrations/supabase/types';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { requireHubEnvironment } from '../../supabase/functions/_shared/fiscal-environment';
import { z } from 'zod';

type FiscalDocumentInsert = TablesInsert<'fiscal_documents'>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface IssueCteGroupInput extends BuildCtePayloadInput {
  /** Ids das NFs de entrada agrupadas neste CT-e. */
  fiscal_document_ids: string[];
  /** Ids das cargas cobertas pelo CT-e. */
  load_ids: string[];
  /** Metadados operacionais para persistência. */
  meta: {
    client_id?: string | null;
    consignee_client_id?: string | null;
    invoice_number?: string | null;
  };
}

/**
 * Emite um CT-e no Hub Fiscal usando o emitente selecionado.
 * - Cria o registro em `fiscal_documents` como `transmitting` antes de invocar o proxy.
 * - Salva o `cte_payload` completo no snapshot.
 * - Após retorno, grava `hub_document_id`, `access_key`, `sefaz_*` e `status` final.
 */
export function useIssueCTe() {
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: IssueCteGroupInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      if (!input.emitter?.id) throw new Error('Emitente não selecionado');

      const built = buildCtePayload(input);
      if (!built.ok) {
        throw new Error(`Campos obrigatórios ausentes: ${built.missing.join(', ')}`);
      }

      // 1. Cria registro em fiscal_documents com snapshot
      const cbsRate = 0.90;
      const ibsRate = 0.10;
      const freightValue = input.totals.freight_value;
      const cbsValue = freightValue > 0 ? (freightValue * cbsRate) / 100 : null;
      const ibsValue = freightValue > 0 ? (freightValue * ibsRate) / 100 : null;

      const environment = requireHubEnvironment(input.emitter.environment);
      const snapshot = {
          tenant_id: currentTenant.id,
          created_by: user?.id,
          document_type: 'outbound',
          client_id: input.meta.client_id || null,
          remitter: input.remitter?.name || '',
          remitter_cnpj: input.remitter?.cnpj || null,
          recipient: input.recipient?.name || '',
          recipient_cnpj: input.recipient?.cnpj || null,
          recipient_city: input.recipient?.address?.city || null,
          recipient_state: input.recipient?.address?.state || null,
          pallet_count: input.totals.pallet_count || 0,
          weight_kg: input.totals.weight_kg || 0,
          value: freightValue,
          freight_value: freightValue,
          freight_value_original: freightValue,
          product_summary: (input.observations || '').slice(0, 500) || null,
          status: 'transmitting',
          issue_date: new Date().toISOString().slice(0, 10),
          cbs_base: freightValue > 0 ? freightValue : null,
          cbs_rate: cbsRate,
          cbs_value: cbsValue,
          ibs_base: freightValue > 0 ? freightValue : null,
          ibs_rate: ibsRate,
          ibs_value: ibsValue,
          emitter_id: input.emitter.id,
          cte_payload: built.payload as Json,
          cte_taker_role: input.takerRole,
          cte_driver_id: input.driver?.id || null,
          cte_vehicle_id: input.vehicle?.id || null,
          cte_consignee_client_id: input.meta.consignee_client_id || null,
          // Snapshot do seguro por emissão — garante que CT-e/DACTE e nota
          // apresentem exatamente a seguradora, apólice e averbação auditadas.
          insurer_name: input.insurer?.name || null,
          insurer_cnpj: (input.insurer?.cnpj || '').replace(/\D/g, '') || null,
          insurer_policy: input.insurer?.policy || null,
          insurer_endorsement: input.insurer?.endorsement || null,
          insured_amount:
            input.insurer?.insured_amount ?? (input.totals.cargo_value || null),
          insurance_premium: input.freightComposition?.insurance_value ?? null,
        } satisfies Omit<FiscalDocumentInsert,'invoice_number'>;
      const prepared = await supabase.rpc('prepare_cte_issue', {
        _tenant_id: currentTenant.id, _emitter_id: input.emitter.id, _environment: environment,
        _source_ids: input.fiscal_document_ids, _snapshot: snapshot as Json,
      });
      if (prepared.error) {
        if(prepared.error.message.includes('fiscal_snapshot_changed_reconcile_first'))
          throw new Error('Já existe uma operação com outros valores para estas notas. Consulte/recupere a operação no Monitor CT-e antes de alterar a prévia.');
        throw new Error('Não foi possível reservar as notas para emissão: '+prepared.error.message);
      }
      const parsed = z.object({id:z.string().uuid(),tenant_id:z.string(),emitter_id:z.string(),cte_payload:z.object({
        environment:z.enum(['sandbox','homologation','production']),emitterCnpj:z.string(),payload:z.record(z.unknown()),
      }).passthrough()}).parse(prepared.data);
      if(parsed.tenant_id!==currentTenant.id||parsed.emitter_id!==input.emitter.id||parsed.cte_payload.environment!==environment)
        throw new Error('Reserva fiscal incompatível com a empresa ou ambiente selecionado.');
      // Always send the persisted snapshot; a remount/retry must not change an uncertain operation.
      const hubResponse = await hubFiscal.emit({
        type:'cte', emitterId:input.emitter.id, fiscalDocumentId:parsed.id,
        body:{...parsed.cte_payload, externalId:'agvlog-cte-'+parsed.id} as EmitParams['body'],
      });
      const status=String(hubResponse.hub?.document?.status||'').toLowerCase();
      if(['rejected','rejeitado','cancelled','error'].includes(status))
        throw new Error(hubResponse.hub?.document?.message||'Documento fiscal recusado. Corrija os dados antes de uma nova emissão.');
      return {fiscal_document_id:parsed.id,hub:hubResponse};
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['cte_search'] });
      qc.invalidateQueries({ queryKey: ['cte_batches'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['eligible_ctes'] });
    },
    onError: (e: unknown) => {
      toast.error('Falha ao emitir CT-e', { description: errorMessage(e) });
    },
  });
}

export function useSyncCTe() {
  const {currentTenant}=useTenant();const qc=useQueryClient();
  return useMutation({mutationFn:async(fiscalDocumentId:string)=>{
    if(!currentTenant)throw new Error('Tenant não selecionado');
    const {data:doc,error}=await supabase.from('fiscal_documents').select('id,hub_document_id,emission_id')
      .eq('tenant_id',currentTenant.id).eq('id',fiscalDocumentId).maybeSingle();
    if(error)throw error;
    if(!doc?.hub_document_id)throw new Error('Documento sem referência no Hub. Recupere a operação existente; não reemita.');
    const res=await hubFiscal.sync(doc.hub_document_id,doc.emission_id||undefined,fiscalDocumentId);
    if(res.success!==true)throw new Error(res.error?.message||'Não foi possível confirmar o estado fiscal.');
    // The server commits the status. A delayed browser response must not overwrite a newer callback.
    return {success:true,hub:res};
  },onSuccess:()=>{for(const key of ['fiscal_documents','cte_search','cte_monitor','cte_documents','eligible_ctes','billing_documents'])qc.invalidateQueries({queryKey:[key]});}});
}

export function useCancelCTe() {
  const toast = useSonnerToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { fiscalDocumentId: string; justificativa: string }) => {
      if (!args.justificativa || args.justificativa.trim().length < 15) {
        throw new Error('Justificativa deve ter no mínimo 15 caracteres.');
      }
      const { data: doc } = await supabase
        .from('fiscal_documents')
        .select('id, hub_document_id, emission_id')
        .eq('id', args.fiscalDocumentId)
        .maybeSingle();
      if (!doc?.hub_document_id) throw new Error('CT-e ainda não transmitido');
      const res = await hubFiscal.cancel(
        doc.hub_document_id,
        args.justificativa.trim(),
        doc.emission_id || undefined,
        args.fiscalDocumentId
      );
      if (res?.success === true) {
        // O proxy persiste o estado devolvido pelo Hub. Não sobrescrever aqui:
        // o Hub pode confirmar o cancelamento já nesta mesma resposta.
      } else {
        // Se a rejeição for fiscal (ex: cStat 135 - Evento já registrado),
        // o Hub retorna success=false. Preservamos o status original (authorized)
        // para que o botão de cancelamento continue disponível.
        const hubError = res?.hub?.error || res?.error;
        const technicalMessage = hubError && 'technicalMessage' in hubError
          ? String(hubError.technicalMessage || '')
          : '';
        const msg = hubError?.message || technicalMessage || 'Cancelamento recusado pelo Hub Fiscal.';
        
        // Preserve the authoritative provider status, including a cancellation already confirmed by callback.
        throw new Error(msg);
      }
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['issued_ctes'] });
      qc.invalidateQueries({ queryKey: ['cte_monitor'] });
      qc.invalidateQueries({ queryKey: ['cte_batches'] });
    },
    onError: (e: unknown) => {
      toast.error('Falha ao cancelar CT-e', { description: errorMessage(e) });
      // Uma recusa fiscal também pode atualizar sefaz_status no proxy.
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['issued_ctes'] });
      qc.invalidateQueries({ queryKey: ['cte_monitor'] });
    },
  });
}

/** Recover the persisted operation; never manufacture a new fiscal identity. */
export function useResendCte() {
 const {currentTenant}=useTenant();const qc=useQueryClient();
 return useMutation({mutationFn:async(id:string)=>{
  if(!currentTenant)throw new Error('Tenant não selecionado');
  const {data:emission,error}=await supabase.from('hub_fiscal_emissions').select('emitter_id,environment,request_payload,fiscal_document_id,cte_document_id')
   .eq('tenant_id',currentTenant.id).eq('doc_type','cte').or('fiscal_document_id.eq.'+id+',cte_document_id.eq.'+id).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  if(!emission?.emitter_id||!emission.request_payload)throw new Error('Sem operação fiscal registrada. Volte à prévia de faturamento; não há reenvio automático.');
  const body=z.object({emitterCnpj:z.string(),environment:z.enum(['sandbox','homologation','production']),payload:z.record(z.unknown())}).passthrough().parse(emission.request_payload);
  requireHubEnvironment(body.environment,emission.environment);
  const result=await hubFiscal.emit({type:'cte',emitterId:emission.emitter_id,fiscalDocumentId:emission.fiscal_document_id||undefined,cteDocumentId:emission.cte_document_id||undefined,body});
  if(['rejected','cancelled'].includes(String(result.hub?.document?.status)))throw new Error(result.hub?.document?.message||'Documento recusado ou cancelado. Corrija pela prévia de faturamento.');
  return result;
 },onSuccess:()=>{for(const key of ['cte_monitor','cte_search','fiscal_documents','cte_documents','billing_documents','eligible_ctes'])qc.invalidateQueries({queryKey:[key]});}});
}
