import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export function useGenerateCTe() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (load: {
      id: string;
      load_number: string;
      destination: string | null;
      total_pallet_count: number;
      total_weight_kg: number;
      vehicle_id: string | null;
      vehicles?: { plate: string; nickname: string | null } | null;
      drivers?: { name: string } | null;
    }) => {
      // Check if CT-e already exists for this load
      const { data: existing } = await supabase
        .from('fiscal_documents')
        .select('id')
        .eq('load_id', load.id)
        .eq('document_type', 'outbound')
        .eq('tenant_id', currentTenant!.id)
        .limit(1);

      if (existing && existing.length > 0) {
        throw new Error('CT-e já existe para esta carga');
      }

      const cteNumber = `CTE-${load.load_number}`;

      const { data, error } = await supabase.from('fiscal_documents').insert({
        tenant_id: currentTenant!.id,
        created_by: user?.id,
        document_type: 'outbound',
        invoice_number: cteNumber,
        load_id: load.id,
        remitter: currentTenant!.name || 'Transportadora',
        recipient: load.destination || 'Destino não informado',
        pallet_count: load.total_pallet_count || 0,
        weight_kg: load.total_weight_kg || 0,
        product_summary: `Carga ${load.load_number} - ${load.vehicles?.plate || 'S/V'} - ${load.drivers?.name || 'S/M'}`,
        status: 'confirmed',
        issue_date: new Date().toISOString().slice(0, 10),
      } as any).select().single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}
