import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import { buildCtePayload, type BuildCtePayloadInput } from '@/lib/fiscal/cteBuilder';
import { toast } from 'sonner';

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

      const externalId = `cte-${currentTenant.id.slice(0, 8)}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      const { data: inserted, error: insErr } = await supabase
        .from('fiscal_documents')
        .insert({
          tenant_id: currentTenant.id,
          created_by: user?.id,
          document_type: 'outbound',
          invoice_number: input.meta.invoice_number || externalId,
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
          cte_payload: built.payload as any,
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
        } as any)
        .select()
        .single();
      if (insErr) throw insErr;

      // 2. Emite no Hub
      const emitBody = { ...(built.payload as any), externalId };
      let hubResponse: any;
      try {
        console.log(`[useIssueCTe] Transmitindo CT-e ${inserted.id} (emitter: ${input.emitter.id})`);
        hubResponse = await hubFiscal.emit({
          type: 'cte',
          body: emitBody,
          fiscalDocumentId: inserted.id,
          emitterId: input.emitter.id,
        });
        console.log(`[useIssueCTe] Resposta do Hub:`, hubResponse);
      } catch (err: any) {
        console.error(`[useIssueCTe] Erro na transmissão:`, err);
        // Erro de invocação — deixa como rejected para o operador ver
        await supabase
          .from('fiscal_documents')
          .update({
            status: 'rejected',
            sefaz_status: 'error',
            sefaz_message: err?.message || 'Falha ao invocar Hub Fiscal',
          } as any)
          .eq('id', inserted.id);
        throw err;
      }

      const doc = hubResponse?.hub?.document || {};
      const emissionId = hubResponse?.emission?.id;
      const success = hubResponse?.success !== false && !doc?.error;

      const update: Record<string, any> = {
        hub_document_id: doc.id || null,
        emission_id: emissionId || null,
        access_key: doc.accessKey || null,
        sefaz_protocol: doc.authorizationProtocol || doc.plugnotasProtocol || null,
        sefaz_status: doc.status || (success ? 'processing' : 'error'),
        sefaz_status_code: doc.cStat != null ? String(doc.cStat) : null,
        sefaz_message: doc.message || null,
        status: success ? (doc.status === 'authorized' ? 'authorized' : 'transmitting') : 'rejected',
      };
      for (const k of Object.keys(update)) if (update[k] == null) delete update[k];

      await supabase.from('fiscal_documents').update(update as any).eq('id', inserted.id);

      // Marca as NFs de entrada agrupadas neste CT-e para que sumam da tela de
      // Faturamento (CT-e Hub) e evitem dupla emissão. Só marcamos se a
      // transmissão foi aceita pelo Hub (success = true).
      if (success && input.fiscal_document_ids?.length) {
        try {
          await supabase
            .from('fiscal_documents')
            .update({
              cte_emitted_at: new Date().toISOString(),
              cte_emitted_outbound_id: inserted.id,
            } as any)
            .in('id', input.fiscal_document_ids)
            .eq('tenant_id', currentTenant.id);
        } catch {
          /* marcação best-effort — não deve derrubar a emissão */
        }
      }

      return { fiscal_document_id: inserted.id, hub: hubResponse };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['cte_batches'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
    },
    onError: (e: any) => {
      toast.error('Falha ao emitir CT-e', { description: e?.message });
    },
  });
}

export function useSyncCTe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fiscalDocumentId: string) => {
      const { data: doc } = await supabase
        .from('fiscal_documents')
        .select('id, hub_document_id, emission_id')
        .eq('id', fiscalDocumentId)
        .maybeSingle();
      const anyDoc = doc as any;
      if (!anyDoc?.hub_document_id) throw new Error('CT-e ainda não transmitido ao Hub Fiscal');
      const res = await hubFiscal.sync(anyDoc.hub_document_id, anyDoc.emission_id || undefined);
      const d: any = res?.hub?.document || {};
      const success = res?.success !== false;
      const update: Record<string, any> = {
        access_key: d.accessKey || undefined,
        sefaz_protocol: d.authorizationProtocol || d.plugnotasProtocol || undefined,
        sefaz_status: d.status || undefined,
        sefaz_status_code: d.cStat != null ? String(d.cStat) : undefined,
        sefaz_message: d.message || undefined,
        status:
          d.status === 'authorized' ? 'authorized' : d.status === 'rejected' ? 'rejected' : undefined,
      };
      for (const k of Object.keys(update)) if (update[k] === undefined) delete update[k];
      if (Object.keys(update).length) {
        await supabase.from('fiscal_documents').update(update as any).eq('id', fiscalDocumentId);
      }
      return { success, hub: res };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    },
  });
}

export function useCancelCTe() {
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
      const anyDoc = doc as any;
      if (!anyDoc?.hub_document_id) throw new Error('CT-e ainda não transmitido');
      const res = await hubFiscal.cancel(
        anyDoc.hub_document_id,
        args.justificativa.trim(),
        anyDoc.emission_id || undefined,
        args.fiscalDocumentId
      );
      if (res?.success === true) {
        // Agora o cancelamento é assíncrono para garantir a "fonte da verdade".
        // O poll de status (cte-status-poll) irá confirmar o cancelamento final.
        await supabase
          .from('fiscal_documents')
          .update({
            status: 'transmitting',
            sefaz_status: 'cancelling',
            sefaz_message: `Cancelamento solicitado: ${args.justificativa}`,
          } as any)
          .eq('id', args.fiscalDocumentId);
      } else {
        // Se a rejeição for fiscal (ex: cStat 135 - Evento já registrado),
        // o Hub retorna success=false. Preservamos o status original (authorized)
        // para que o botão de cancelamento continue disponível.
        const hubError = res?.hub?.error || res?.error;
        const msg = hubError?.message || (hubError as any)?.technicalMessage || 'Cancelamento recusado pelo Hub Fiscal.';
        
        // Atualiza sefaz_message para que o usuário veja o motivo da rejeição no monitor
        await supabase
          .from('fiscal_documents')
          .update({
            sefaz_message: `Rejeição cancelamento: ${msg}`,
            sefaz_status: 'authorized' // Garante que não fique travado em 'cancelling' ou mude para 'rejected'
          } as any)
          .eq('id', args.fiscalDocumentId);

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
    onError: (e: any) => {
      toast.error('Falha ao cancelar CT-e', { description: e?.message });
      // Uma recusa fiscal também pode atualizar sefaz_status no proxy.
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['issued_ctes'] });
      qc.invalidateQueries({ queryKey: ['cte_monitor'] });
    },
  });
}