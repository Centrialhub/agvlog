import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import type { CustomerWindow } from '@/lib/route-planning/routePlanningTypes';

/**
 * Carrega janelas dos clientes referenciados nas paradas planejadas.
 * Para MVP, pega a primeira janela ativa do cliente (sem distinguir weekday).
 */
export function useCustomerDeliveryWindowsForRouting(clientIds: string[]) {
  const { currentTenant } = useTenant();
  const ids = Array.from(new Set(clientIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ['customer_delivery_windows_routing', currentTenant?.id, ids.join(',')],
    queryFn: async (): Promise<CustomerWindow[]> => {
      if (!currentTenant || ids.length === 0) return [];
      const { data, error } = await supabase
        .from('customer_delivery_windows')
        .select('client_id, start_time, end_time, active, weekday')
        .eq('tenant_id', currentTenant.id)
        .in('client_id', ids)
        .eq('active', true);
      if (error) throw error;
      const byClient = new Map<string, CustomerWindow>();
      (data || []).forEach((w: any) => {
        if (!byClient.has(w.client_id)) {
          byClient.set(w.client_id, {
            client_id: w.client_id,
            start_time: String(w.start_time).slice(0, 5),
            end_time: String(w.end_time).slice(0, 5),
          });
        }
      });
      return Array.from(byClient.values());
    },
    enabled: !!currentTenant,
  });
}