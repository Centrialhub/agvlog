import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { calculateFreight } from './useFreightCalculator';
import type { Json, TablesUpdate } from '@/integrations/supabase/types';
import { readLoadFreightContext } from '@/lib/fiscalDocuments/loadFreightContext';

/**
 * Recalculates the freight for a single CT-e (outbound fiscal_document) using
 * its current destination/UF/municipality + weight/pallets and the linked NF-e
 * context (client/payer group / NF total value). Updates the CT-e in place,
 * preserves manual overrides, and upserts the audit row in freight_calculation_log.
 */
export function useRecalculateCTeFreight() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (cteId: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');

      // Load current CT-e
      const { data: cte, error: cteErr } = await supabase
        .from('fiscal_documents')
        .select('*')
        .eq('id', cteId)
        .eq('tenant_id', currentTenant.id)
        .single();
      if (cteErr) throw cteErr;
      if (!cte || cte.document_type !== 'outbound') {
        throw new Error('Documento não é um CT-e');
      }
      if (cte.freight_overridden) {
        return { skipped: true, reason: 'Frete possui override manual — recalculo ignorado' };
      }

      // Pull NF-e context (client / payer group / value) from the same load
      let clientId = cte.client_id || null;
      let nfeTotalValue = 0;
      if (cte.load_id) {
        const context = await readLoadFreightContext(currentTenant.id, cte.load_id);
        const nfeDocs = context.documents;
        nfeTotalValue = nfeDocs.reduce((sum, document) => sum + (Number(document.value) || 0), 0);
        if (!clientId) {
          const referenceDocument = nfeDocs.find((document) => document.client_id);
          clientId = referenceDocument?.client_id || null;
        }
      }

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

      const result = await calculateFreight({
        tenantId: currentTenant.id,
        clientId,
        payerGroup,
        destination: cte.recipient || cte.recipient_city,
        destinationState: cte.recipient_state,
        destinationMunicipality: cte.recipient_city,
        totalValue: nfeTotalValue,
        totalWeight: Number(cte.weight_kg) || 0,
        totalPallets: Number(cte.pallet_count) || 0,
      });

      if (!result.success || !result.breakdown) {
        throw new Error(result.error || 'Falha ao recalcular frete');
      }

      const newValue = result.value;
      const cbsRate = 0.90;
      const ibsRate = 0.10;

      const updatePayload: TablesUpdate<'fiscal_documents'> = {
        freight_value: newValue,
        freight_value_original: newValue,
        value: newValue,
        freight_table_id: result.breakdown.tableId || null,
        freight_breakdown: result.breakdown as unknown as Json,
        cbs_base: newValue,
        cbs_rate: cbsRate,
        cbs_value: newValue * cbsRate / 100,
        ibs_base: newValue,
        ibs_rate: ibsRate,
        ibs_value: newValue * ibsRate / 100,
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = await supabase.rpc('update_fiscal_document_with_freight_v1' as never, {
        _tenant_id: currentTenant.id,
        _document_id: cteId,
        _expected_updated_at: cte.updated_at,
        _document_patch: {},
        _freight_patch: updatePayload,
        _breakdown: result.breakdown,
      } as never);
      if (upErr) throw upErr;

      return { ok: true, value: newValue, breakdown: result.breakdown };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['load_documents'] });
    },
  });
}

// Fields that, when changed, must trigger an automatic recalc
export const FREIGHT_RECALC_TRIGGER_FIELDS = [
  'recipient',
  'recipient_state',
  'recipient_city',
  'recipient_neighborhood',
  'weight_kg',
  'pallet_count',
] as const;
