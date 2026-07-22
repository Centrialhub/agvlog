import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface RoutingLoadItem {
  id: string;
  load_id: string;
  item_description: string;
  pallet_count: number;
  weight_kg: number;
  volume_m3: number;
  fiscal_document_id: string | null;
  fiscal_documents?: {
    invoice_number: string | null;
    remitter: string | null;
    recipient: string | null;
    recipient_city: string | null;
    recipient_state: string | null;
    recipient_neighborhood: string | null;
    client_id: string | null;
    value: number | null;
    weight_kg: number | null;
    issue_date: string | null;
  } | null;
}

export interface RoutingLoad {
  id: string;
  load_number: string;
  destination: string | null;
  total_weight_kg: number | null;
  total_volume_m3: number | null;
  total_pallet_count: number | null;
  status: string;
  created_at: string;
  notes: string | null;
  items: RoutingLoadItem[];
}

export function usePendingLoadsForRouting() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pending_loads_for_routing', currentTenant?.id],
    queryFn: async (): Promise<RoutingLoad[]> => {
      if (!currentTenant) return [];
      const { data: loads, error } = await (supabase.from('loads') as any)
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'planned')
        .is('trip_id', null)
        .eq('on_hold', false)
        .order('destination', { ascending: true });
      if (error) throw error;
      if (!loads || loads.length === 0) return [];

      const loadIds = loads.map((l: any) => l.id);
      const { data: items, error: itemsErr } = await supabase
        .from('load_items')
        .select('*, fiscal_documents(invoice_number, remitter, recipient, recipient_city, recipient_state, recipient_neighborhood, client_id, value, weight_kg, issue_date)')
        .in('load_id', loadIds)
        .order('created_at', { ascending: true });
      if (itemsErr) throw itemsErr;

      const byLoad: Record<string, RoutingLoadItem[]> = {};
      (items || []).forEach((it: any) => {
        (byLoad[it.load_id] ||= []).push(it);
      });
      return loads.map((l: any) => ({ ...l, items: byLoad[l.id] || [] })) as RoutingLoad[];
    },
    enabled: !!currentTenant,
  });
}
