import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Load } from './useLoads';

async function lookupFreightValue(
  tenantId: string,
  destination: string | null,
  totalValue: number,
  totalWeight: number,
  totalPallets: number
): Promise<number> {
  // Find matching freight table (not blocked, within validity)
  const today = new Date().toISOString().slice(0, 10);
  const { data: tables } = await supabase
    .from('freight_tables')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('blocked', false)
    .lte('valid_from', today)
    .order('table_code', { ascending: false });

  if (!tables || tables.length === 0) return 0;

  // Filter by validity end date
  const valid = tables.filter((t: any) => !t.valid_until || t.valid_until >= today);
  if (valid.length === 0) return 0;

  // Try to match by destination region/municipality
  let match = valid[0]; // fallback to first valid table
  if (destination) {
    const destLower = destination.toLowerCase();
    const regionMatch = valid.find((t: any) =>
      (t.destination_region && destLower.includes(t.destination_region.toLowerCase())) ||
      (t.destination_municipality && destLower.includes(t.destination_municipality.toLowerCase()))
    );
    if (regionMatch) match = regionMatch;
  }

  // Calculate freight value
  let freight = 0;
  const ratePercent = Number(match.rate_percent) || 0;
  const fixedVal = Number(match.fixed_value) || 0;
  const minVal = Number(match.min_value) || 0;
  const perKg = Number(match.per_kg_value) || 0;
  const perPallet = Number(match.per_pallet_value) || 0;

  if (ratePercent > 0) freight += totalValue * (ratePercent / 100);
  if (fixedVal > 0) freight += fixedVal;
  if (perKg > 0) freight += totalWeight * perKg;
  if (perPallet > 0) freight += totalPallets * perPallet;

  return Math.max(freight, minVal);
}

export function useGenerateCTe() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (load: Load) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');

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

      // Fetch load_items with NF-e values
      const { data: loadItems } = await (supabase as any)
        .from('load_items')
        .select('item_description, quantity, pallet_count, weight_kg, orders(order_number, clients(company_name))')
        .eq('load_id', load.id);

      const itemSummary = (loadItems || [])
        .map((li: any) => li.item_description || li.orders?.order_number || 'Item')
        .join(', ')
        .substring(0, 500);

      const totalPallets = (loadItems || []).reduce((s: number, li: any) => s + (li.pallet_count || 0), 0);
      const totalWeight = (loadItems || []).reduce((s: number, li: any) => s + (li.weight_kg || 0), 0);

      // Fetch NF-e total value for percentage-based freight
      const { data: nfeDocs } = await supabase
        .from('fiscal_documents')
        .select('value')
        .eq('load_id', load.id)
        .eq('document_type', 'inbound')
        .eq('tenant_id', currentTenant.id);

      const nfeTotalValue = (nfeDocs || []).reduce((s: number, d: any) => s + (Number(d.value) || 0), 0);

      // Lookup freight value from freight_tables
      const freightValue = await lookupFreightValue(
        currentTenant.id,
        load.destination,
        nfeTotalValue,
        totalWeight || load.total_weight_kg || 0,
        totalPallets || load.total_pallet_count || 0
      );

      const cteNumber = `CTE-${load.load_number}`;

      const { data, error } = await supabase.from('fiscal_documents').insert({
        tenant_id: currentTenant.id,
        created_by: user?.id,
        document_type: 'outbound',
        invoice_number: cteNumber,
        load_id: load.id,
        remitter: currentTenant.name || 'Transportadora',
        recipient: load.destination || 'Destino não informado',
        pallet_count: totalPallets || load.total_pallet_count || 0,
        weight_kg: totalWeight || load.total_weight_kg || 0,
        value: freightValue > 0 ? freightValue : null,
        product_summary: itemSummary || `Carga ${load.load_number} - ${load.vehicles?.plate || 'S/V'} - ${load.drivers?.name || 'S/M'}`,
        status: 'confirmed',
        issue_date: new Date().toISOString().slice(0, 10),
      } as any).select().single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['load_documents'] });
    },
  });
}
