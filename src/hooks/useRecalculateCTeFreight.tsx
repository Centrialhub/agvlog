import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { calculateFreight, logFreightCalculation } from './useFreightCalculator';

/**
 * Recalculates the freight for a single CT-e (outbound fiscal_document) using
 * its current destination/UF/municipality + weight/pallets and the linked NF-e
 * context (client/payer group / NF total value). Updates the CT-e in place,
 * preserves manual overrides, and upserts the audit row in freight_calculation_log.
 */
export function useRecalculateCTeFreight() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (cteId: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');

      // Load current CT-e
      const { data: cte, error: cteErr } = await supabase
        // linter:allow-direct-write fiscal_documents legacy-refactor 2026-12-31
      .from('fiscal_documents')
        .select('*')
        .eq('id', cteId)
        .eq('tenant_id', currentTenant.id)
        .single();
      if (cteErr) throw cteErr;
      if (!cte || cte.document_type !== 'outbound') {
        throw new Error('Documento não é um CT-e');
      }
      if ((cte as any).freight_overridden) {
        return { skipped: true, reason: 'Frete possui override manual — recalculo ignorado' };
      }

      // Pull NF-e context (client / payer group / value) from the same load
      let clientId: string | null = (cte as any).client_id || null;
      let nfeTotalValue = 0;
      if ((cte as any).load_id) {
        const { data: nfeDocs } = await supabase
          // linter:allow-direct-write fiscal_documents legacy-refactor 2026-12-31
      .from('fiscal_documents')
          .select('client_id, value')
          .eq('load_id', (cte as any).load_id)
          .eq('tenant_id', currentTenant.id)
          .eq('document_type', 'inbound');
        nfeTotalValue = (nfeDocs || []).reduce((s: number, d: any) => s + (Number(d.value) || 0), 0);
        if (!clientId) {
          const ref = (nfeDocs || []).find((d: any) => d.client_id);
          clientId = ref ? (ref as any).client_id : null;
        }
      }

      let payerGroup: string | null = null;
      if (clientId) {
        const { data: cli } = await supabase
          .from('clients')
          .select('payer_group')
          .eq('id', clientId)
          .maybeSingle();
        payerGroup = (cli as any)?.payer_group || null;
      }

      const result = await calculateFreight({
        tenantId: currentTenant.id,
        clientId,
        payerGroup,
        destination: (cte as any).recipient || (cte as any).recipient_city,
        destinationState: (cte as any).recipient_state,
        destinationMunicipality: (cte as any).recipient_city,
        totalValue: nfeTotalValue,
        totalWeight: Number((cte as any).weight_kg) || 0,
        totalPallets: Number((cte as any).pallet_count) || 0,
      });

      if (!result.success || !result.breakdown) {
        throw new Error(result.error || 'Falha ao recalcular frete');
      }

      const newValue = result.value;
      const cbsRate = 0.90;
      const ibsRate = 0.10;

      const { error: upErr } = await supabase
        // linter:allow-direct-write fiscal_documents legacy-refactor 2026-12-31
      .from('fiscal_documents')
        // guardrail:allow-direct-write
        .update({
          freight_value: newValue,
          freight_value_original: newValue,
          value: newValue,
          freight_table_id: result.breakdown.tableId || null,
          freight_breakdown: result.breakdown as any,
          cbs_base: newValue,
          cbs_rate: cbsRate,
          cbs_value: newValue * cbsRate / 100,
          ibs_base: newValue,
          ibs_rate: ibsRate,
          ibs_value: newValue * ibsRate / 100,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', cteId)
        .eq('tenant_id', currentTenant.id);
      if (upErr) throw upErr;

      // Upsert audit log (no duplicates per CT-e)
      try {
        await logFreightCalculation(currentTenant.id, cteId, 'cte', result.breakdown, user?.id);
      } catch (e) {
        console.warn('Falha ao registrar log de recálculo de frete', e);
      }

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