import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { Load } from './useLoads';
import { calculateFreight } from './useFreightCalculator';
import type { Json, Tables, TablesInsert } from '@/integrations/supabase/types';
import { localDateInputValue } from '@/lib/utils/formatDate';
import { readLoadFreightContext } from '@/lib/fiscalDocuments/loadFreightContext';

interface GenerateCteOptions {
  load: Load;
  emitterId?: string | null;
}

interface GenerateCteDiagnostics {
  warnings: string[];
  missingContext: string[];
  freightSuccess: boolean;
  freightError: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  missingFields: string[];
}

export type GeneratedCteDocument = Tables<'fiscal_documents'> & {
  _diagnostics: GenerateCteDiagnostics;
};

function isGenerateCteOptions(arg: Load | GenerateCteOptions): arg is GenerateCteOptions {
  return 'load' in arg;
}

export function useGenerateCTe() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (arg: Load | GenerateCteOptions): Promise<GeneratedCteDocument> => {
      const load = isGenerateCteOptions(arg) ? arg.load : arg;
      const overrideEmitterId = isGenerateCteOptions(arg) ? arg.emitterId : undefined;
      if (!currentTenant) throw new Error('Tenant não selecionado');

      // Resolve o emitente (override → default ativo) para preencher remitter/emitter_id na NF-e/CT-e.
      let emitter: Pick<Tables<'tenant_emitters'>, 'id' | 'razao_social' | 'nome_fantasia' | 'cnpj'> | null = null;
      if (overrideEmitterId) {
        const { data, error } = await supabase
          .from('tenant_emitters')
          .select('id, razao_social, nome_fantasia, cnpj')
          .eq('id', overrideEmitterId)
          .eq('tenant_id', currentTenant.id)
          .eq('active', true)
          .maybeSingle();
        if (error) throw error;
        emitter = data || null;
      }
      if (!emitter) {
        const { data, error } = await supabase
          .from('tenant_emitters')
          .select('id, razao_social, nome_fantasia, cnpj')
          .eq('tenant_id', currentTenant.id)
          .eq('active', true)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(1);
        if (error) throw error;
        emitter = data?.[0] || null;
      }
      if (!emitter) {
        throw new Error('Cadastre e ative um emitente antes de gerar o CT-e.');
      }

      // Check if CT-e already exists for this load
      const { data: existing, error: checkError } = await supabase
        .from('fiscal_documents')
        .select('id')
        .eq('load_id', load.id)
        .eq('document_type', 'outbound')
        .eq('tenant_id', currentTenant.id)
        .is('deleted_at', null)
        .limit(1);

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        throw new Error('CT-e já existe para esta carga');
      }

      const context = await readLoadFreightContext(currentTenant.id, load.id);
      const itemDescriptions = context.item_descriptions;
      const orderNames = context.order_names;

      const itemSummary = [...itemDescriptions, ...orderNames]
        .filter(Boolean)
        .join(', ')
        .substring(0, 500) || `Carga ${load.load_number}`;

      const totalPallets = context.total_pallets;
      const totalWeight = context.total_weight;
      const refDocs = context.documents;
      if (!refDocs.length) throw new Error('A carga não possui NF-e vigente para gerar o CT-e.');

      const clientIds = [...new Set(refDocs.map((document) => document.client_id).filter(Boolean))];
      if (clientIds.length > 1) {
        throw new Error('A carga possui NF-es de clientes diferentes. Separe a carga antes de gerar o CT-e.');
      }
      const destinations = new Set(refDocs.map((document) => [
        document.recipient_cnpj?.replace(/\D/g, '') || '',
        document.recipient?.trim().toLocaleUpperCase('pt-BR') || '',
        document.recipient_city?.trim().toLocaleUpperCase('pt-BR') || '',
        document.recipient_state?.trim().toLocaleUpperCase('pt-BR') || '',
      ].join('|')));
      if (destinations.size > 1) {
        throw new Error('A carga possui NF-es com destinatários diferentes. Gere um CT-e por destinatário.');
      }
      const refDoc = refDocs.find((document) => document.client_id) || refDocs[0];
      const clientId = refDoc?.client_id || null;
      const nfeTotalValue = refDocs.reduce((sum, document) => sum + (Number(document.value) || 0), 0);

      let payerGroup: string | null = null;
      if (clientId) {
        const { data: client, error: clientError } = await supabase
          .from('clients')
          .select('payer_group')
          .eq('id', clientId)
          .maybeSingle();
        if (clientError) throw clientError;
        payerGroup = client?.payer_group || null;
      }

      const destState = refDoc?.recipient_state || null;
      const destMunicipality = refDoc?.recipient_city || null;

      // Calculate freight using the full rule engine (region + payer group + client)
      const freightResult = await calculateFreight({
        tenantId: currentTenant.id,
        clientId,
        payerGroup,
        destination: load.destination || destMunicipality,
        destinationState: destState,
        destinationMunicipality: destMunicipality,
        totalValue: nfeTotalValue,
        totalWeight: totalWeight || load.total_weight_kg || 0,
        totalPallets: totalPallets || load.total_pallet_count || 0,
      });

      if (!freightResult.success || !Number.isFinite(freightResult.value) || freightResult.value <= 0) {
        throw new Error(freightResult.error || 'Não existe tabela de frete válida para esta carga. O CT-e não foi criado.');
      }
      const freightValue = freightResult.value;
      const breakdown = freightResult.breakdown;

      // ===== Diagnostic warnings to surface to the user =====
      const warnings: string[] = [];
      const missingContext: string[] = [];
      if (!clientId) missingContext.push('cliente (NF-e sem client_id vinculado)');
      if (!payerGroup) missingContext.push('payer_group (cliente sem grupo pagador definido)');
      if (!destState) missingContext.push('UF de destino');
      if (!destMunicipality) missingContext.push('município de destino');
      if (!load.destination && !destMunicipality) missingContext.push('destino da carga');

      if (!freightResult.success) {
        warnings.push(freightResult.error || 'Falha ao calcular frete');
      }
      if (breakdown?.fallbackUsed) {
        warnings.push(breakdown.fallbackReason || 'Tabela genérica utilizada (fallback)');
      }
      if (breakdown?.missingFields?.length) {
        warnings.push(`Campos substituídos por UNKNOWN: ${breakdown.missingFields.join(', ')}`);
      }
      if (missingContext.length > 0) {
        warnings.push(`Contexto incompleto: ${missingContext.join('; ')}`);
      }

      const cteNumber = `CTE-${load.load_number}`;

      // Calculate IBS/CBS based on freight value (reform tributária)
      const cbsRate = 0.90;
      const ibsRate = 0.10;
      const cbsValue = freightValue > 0 ? freightValue * cbsRate / 100 : null;
      const ibsValue = freightValue > 0 ? freightValue * ibsRate / 100 : null;

      const insertPayload: Omit<TablesInsert<'fiscal_documents'>, 'tenant_id' | 'created_by'> = {
        document_type: 'outbound',
        invoice_number: cteNumber,
        load_id: load.id,
        client_id: clientId,
        emitter_id: emitter.id,
        remitter: emitter.razao_social || emitter.nome_fantasia,
        remitter_cnpj: emitter.cnpj,
        recipient: refDoc.recipient,
        recipient_cnpj: refDoc.recipient_cnpj,
        recipient_state: destState,
        recipient_city: destMunicipality,
        pallet_count: totalPallets || load.total_pallet_count || 0,
        weight_kg: totalWeight || load.total_weight_kg || 0,
        value: freightValue > 0 ? freightValue : null,
        freight_value: freightValue > 0 ? freightValue : null,
        freight_value_original: freightValue > 0 ? freightValue : null,
        freight_table_id: breakdown?.tableId || null,
        freight_breakdown: breakdown ? breakdown as unknown as Json : null,
        product_summary: itemSummary,
        status: 'confirmed',
        issue_date: localDateInputValue(),
        cbs_base: freightValue > 0 ? freightValue : null,
        cbs_rate: cbsRate,
        cbs_value: cbsValue,
        ibs_base: freightValue > 0 ? freightValue : null,
        ibs_rate: ibsRate,
        ibs_value: ibsValue,
      };
      if (!breakdown) throw new Error('O cálculo não retornou os dados de auditoria. O CT-e não foi criado.');
      const { data, error } = await supabase.rpc('create_fiscal_document_with_freight_v1' as never, {
        _tenant_id: currentTenant.id,
        _document: insertPayload,
        _breakdown: breakdown,
      } as never);

      if (error) throw error;
      const created = data as unknown as Tables<'fiscal_documents'>;

      return {
        ...created,
        _diagnostics: {
          warnings,
          missingContext,
          freightSuccess: freightResult.success,
          freightError: freightResult.error || null,
          fallbackUsed: !!breakdown?.fallbackUsed,
          fallbackReason: breakdown?.fallbackReason || null,
          missingFields: breakdown?.missingFields || [],
        },
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['load_documents'] });
    },
  });
}
