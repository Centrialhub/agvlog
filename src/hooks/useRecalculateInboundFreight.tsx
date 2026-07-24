import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { calculateFreight, logFreightCalculation } from './useFreightCalculator';

/**
 * Batch-recalcula a prévia de frete das NF-es (inbound) informadas.
 * Usa o motor de frete atual (tabelas vigentes, payer_group, destino).
 * Ignora documentos com override manual (freight_overridden = true).
 */
export function useRecalculateInboundFreight() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (docIds: string[]) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      if (docIds.length === 0) return { updated: 0, skipped: 0, failed: 0 };

      // Fetch docs in chunks (avoid IN() blowup)
      const chunk = 200;
      const docs: any[] = [];
      for (let i = 0; i < docIds.length; i += chunk) {
        const { data, error } = await supabase
          .from('fiscal_documents')
          .select('id, client_id, recipient, recipient_state, recipient_city, weight_kg, pallet_count, value, freight_overridden')
          .eq('tenant_id', currentTenant.id)
          .eq('document_type', 'inbound')
          .in('id', docIds.slice(i, i + chunk));
        if (error) throw error;
        docs.push(...(data || []));
      }

      // Cache payer_group by client_id
      const clientIds = Array.from(new Set(docs.map(d => d.client_id).filter(Boolean)));
      const payerGroupByClient = new Map<string, string | null>();
      if (clientIds.length > 0) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id, payer_group')
          .in('id', clientIds);
        (clients || []).forEach((c: any) => payerGroupByClient.set(c.id, c.payer_group || null));
      }

      let updated = 0, skipped = 0, failed = 0;

      for (const d of docs) {
        if (d.freight_overridden) { skipped++; continue; }
        try {
          const result = await calculateFreight({
            tenantId: currentTenant.id,
            clientId: d.client_id || null,
            payerGroup: d.client_id ? payerGroupByClient.get(d.client_id) || null : null,
            destination: d.recipient || d.recipient_city,
            destinationState: d.recipient_state,
            destinationMunicipality: d.recipient_city,
            totalValue: Number(d.value) || 0,
            totalWeight: Number(d.weight_kg) || 0,
            totalPallets: Number(d.pallet_count) || 0,
          });
          if (!result.success || !result.breakdown) { failed++; continue; }

          const { error: upErr } = await supabase
            .from('fiscal_documents')
            .update({
              freight_value: result.value,
              freight_value_original: result.value,
              freight_table_id: result.breakdown.tableId || null,
              freight_breakdown: result.breakdown as any,
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', d.id)
            .eq('tenant_id', currentTenant.id);
          if (upErr) { failed++; continue; }

          try {
            await logFreightCalculation(currentTenant.id, d.id, 'nfe', result.breakdown, user?.id);
          } catch { /* non-blocking audit */ }
          updated++;
        } catch {
          failed++;
        }
      }

      return { updated, skipped, failed };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    },
  });
}