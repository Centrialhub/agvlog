import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Load } from './useLoads';

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

      // Fetch actual load_items for this load to build accurate document
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
