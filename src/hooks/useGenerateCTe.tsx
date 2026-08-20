import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Load } from './useLoads';
import { calculateFreight, logFreightCalculation } from './useFreightCalculator';

export function useGenerateCTe() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (arg: Load | { load: Load; emitterId?: string | null }) => {
      const load: Load = (arg as any).load ?? (arg as Load);
      const overrideEmitterId: string | null | undefined = (arg as any).emitterId;
      if (!currentTenant) throw new Error('Tenant não selecionado');

      // Resolve o emitente (override → default ativo) para preencher remitter/emitter_id na NF-e/CT-e.
      let emitter: any = null;
      if (overrideEmitterId) {
        const { data } = await (supabase as any)
          .from('tenant_emitters')
          .select('*')
          .eq('id', overrideEmitterId)
          .maybeSingle();
        emitter = data || null;
      }
      if (!emitter) {
        const { data } = await (supabase as any)
          .from('tenant_emitters')
          .select('*')
          .eq('tenant_id', currentTenant.id)
          .eq('active', true)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(1);
        emitter = data?.[0] || null;
      }

      // Check if CT-e already exists for this load
      const { data: existing, error: checkError } = await supabase
        .from('fiscal_documents')
        .select('id')
        .eq('load_id', load.id)
        .eq('document_type', 'outbound')
        .eq('tenant_id', currentTenant.id)
        .limit(1);

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        throw new Error('CT-e já existe para esta carga');
      }

      // Fetch load_items (without invalid join)
      const { data: loadItems } = await (supabase as any)
        .from('load_items')
        .select('item_description, quantity, pallet_count, weight_kg, order_id')
        .eq('load_id', load.id);

      // Fetch linked orders via load_orders for item summary
      const { data: loadOrders } = await supabase
        .from('load_orders')
        .select('order_id')
        .eq('load_id', load.id);

      let orderNames: string[] = [];
      if (loadOrders && loadOrders.length > 0) {
        const orderIds = loadOrders.map((lo: any) => lo.order_id);
        const { data: orders } = await supabase
          .from('orders')
          .select('order_number, clients(company_name)')
          .in('id', orderIds);
        if (orders) {
          orderNames = orders.map((o: any) => o.order_number || o.clients?.company_name || 'Pedido');
        }
      }

      const itemDescriptions = (loadItems || [])
        .map((li: any) => li.item_description)
        .filter((d: string) => d && d.trim());

      const itemSummary = [...itemDescriptions, ...orderNames]
        .filter(Boolean)
        .join(', ')
        .substring(0, 500) || `Carga ${load.load_number}`;

      const totalPallets = (loadItems || []).reduce((s: number, li: any) => s + (li.pallet_count || 0), 0);
      const totalWeight = (loadItems || []).reduce((s: number, li: any) => s + (Number(li.weight_kg) || 0), 0);

      // Fetch NF-e total value for percentage-based freight
      const { data: nfeDocs } = await supabase
        .from('fiscal_documents')
        .select('value')
        .eq('load_id', load.id)
        .eq('document_type', 'inbound')
        .eq('tenant_id', currentTenant.id);

      const nfeTotalValue = (nfeDocs || []).reduce((s: number, d: any) => s + (Number(d.value) || 0), 0);

      // Resolve client / payer group / destination context from NF-e docs
      const { data: refDocs } = await supabase
        .from('fiscal_documents')
        .select('client_id, recipient_state, recipient_city, recipient_neighborhood, recipient')
        .eq('load_id', load.id)
        .eq('tenant_id', currentTenant.id)
        .eq('document_type', 'inbound')
        .limit(50);

      const refDoc = (refDocs || []).find((d: any) => d.client_id) || (refDocs || [])[0] || {};
      const clientId: string | null = (refDoc as any).client_id || null;

      let payerGroup: string | null = null;
      if (clientId) {
        const { data: cli } = await supabase
          .from('clients')
          .select('payer_group')
          .eq('id', clientId)
          .maybeSingle();
        payerGroup = (cli as any)?.payer_group || null;
      }

      const destState = (refDoc as any).recipient_state || null;
      const destMunicipality = (refDoc as any).recipient_city || null;

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

      const freightValue = freightResult.success ? freightResult.value : 0;
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
      if (freightValue === 0 && !breakdown) {
        warnings.push('Nenhuma tabela de frete ativa encontrada para este tenant — verifique cadastro em /freight');
      }

      const cteNumber = `CTE-${load.load_number}`;

      // Calculate IBS/CBS based on freight value (reform tributária)
      const cbsRate = 0.90;
      const ibsRate = 0.10;
      const cbsValue = freightValue > 0 ? freightValue * cbsRate / 100 : null;
      const ibsValue = freightValue > 0 ? freightValue * ibsRate / 100 : null;

      // guardrail:allow-direct-write
      const { data, error } = await supabase.from('fiscal_documents').insert({
        tenant_id: currentTenant.id,
        created_by: user?.id,
        document_type: 'outbound',
        invoice_number: cteNumber,
        load_id: load.id,
        client_id: clientId,
        emitter_id: emitter?.id || null,
        remitter: emitter?.razao_social || emitter?.nome_fantasia || currentTenant.name || 'Transportadora',
        remitter_cnpj: emitter?.cnpj || null,
        recipient: load.destination || 'Destino não informado',
        recipient_state: destState,
        recipient_city: destMunicipality,
        pallet_count: totalPallets || load.total_pallet_count || 0,
        weight_kg: totalWeight || load.total_weight_kg || 0,
        value: freightValue > 0 ? freightValue : null,
        freight_value: freightValue > 0 ? freightValue : null,
        freight_value_original: freightValue > 0 ? freightValue : null,
        freight_table_id: breakdown?.tableId || null,
        freight_breakdown: breakdown ? (breakdown as any) : null,
        product_summary: itemSummary,
        status: 'confirmed',
        issue_date: new Date().toISOString().slice(0, 10),
        cbs_base: freightValue > 0 ? freightValue : null,
        cbs_rate: cbsRate,
        cbs_value: cbsValue,
        ibs_base: freightValue > 0 ? freightValue : null,
        ibs_rate: ibsRate,
        ibs_value: ibsValue,
      } as any).select().single();

      if (error) throw error;

      // Audit trail of the freight rule selection
      if (breakdown && data?.id) {
        try {
          await logFreightCalculation(currentTenant.id, data.id, 'cte', breakdown, user?.id);
        } catch (e) {
          console.warn('Falha ao registrar log de cálculo de frete', e);
        }
      }

      return {
        ...data,
        _diagnostics: {
          warnings,
          missingContext,
          freightSuccess: freightResult.success,
          freightError: freightResult.error || null,
          fallbackUsed: !!breakdown?.fallbackUsed,
          fallbackReason: breakdown?.fallbackReason || null,
          missingFields: breakdown?.missingFields || [],
        },
      } as any;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['load_documents'] });
    },
  });
}
