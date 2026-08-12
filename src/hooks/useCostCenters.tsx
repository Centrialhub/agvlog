import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export function useCostCenters() {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['cost_centers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      
      // We'll derive cost centers from existing tables to keep it simple and automated
      // or we can use a hardcoded list for now as requested "options specific".
      // Let's get unique cost_centers already used in employees, assets, and the new columns.
      
      const [empRes, assetRes, payRes] = await Promise.all([
        supabase.from('employees').select('cost_center').eq('tenant_id', currentTenant.id).not('cost_center', 'is', null),
        supabase.from('assets').select('cost_center').eq('tenant_id', currentTenant.id).not('cost_center', 'is', null),
        supabase.from('payables').select('cost_center').eq('tenant_id', currentTenant.id).not('cost_center', 'is', null)
      ]);

      const set = new Set<string>();
      
      // Default common logistics cost centers
      ['Operacional', 'Administrativo', 'Manutenção', 'Combustível', 'RH', 'Financeiro', 'Frota', 'Armazém'].forEach(c => set.add(c));
      
      empRes.data?.forEach(e => e.cost_center && set.add(e.cost_center));
      assetRes.data?.forEach(a => a.cost_center && set.add(a.cost_center));
      payRes.data?.forEach(p => p.cost_center && set.add(p.cost_center));

      return Array.from(set).sort();
    },
    enabled: !!currentTenant,
  });
}
