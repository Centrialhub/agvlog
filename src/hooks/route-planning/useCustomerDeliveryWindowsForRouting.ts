import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import type { CustomerWindow } from '@/lib/route-planning/routePlanningTypes';

/** Carrega todas as janelas ativas; o planejador escolhe somente o dia da rota. */
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
        .eq('active', true)
        .order('client_id', { ascending: true })
        .order('weekday', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) throw error;
      return (data || []).map((window) => ({
        client_id: window.client_id,
        weekday: window.weekday,
        start_time: String(window.start_time).slice(0, 5),
        end_time: String(window.end_time).slice(0, 5),
      }));
    },
    enabled: !!currentTenant,
  });
}
