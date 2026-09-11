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
    supplier_id?: string | null;
    client_address?: string | null;
    client_location?: {
      latitude: number;
      longitude: number;
      provider: string | null;
      accuracy_m: number | null;
      confidence: number | null;
      address_hash: string;
    } | null;
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

type RoutingClientLocation = {
  id: string;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  address_geocode_status?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
  address_geocode_hash?: string | null;
  address_geocode_provider?: string | null;
  address_geocode_accuracy_m?: number | null;
  address_geocode_confidence?: number | null;
};

export function usePendingLoadsForRouting() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pending_loads_for_routing', currentTenant?.id],
    queryFn: async (): Promise<RoutingLoad[]> => {
      if (!currentTenant) return [];
      const { data: loads, error } = await supabase.from('loads')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'planned')
        .is('trip_id', null)
        .eq('on_hold', false)
        .order('destination', { ascending: true });
      if (error) throw error;
      if (!loads || loads.length === 0) return [];

      const loadIds = loads.map(load => load.id);
      const { data: items, error: itemsErr } = await supabase
        .from('load_items')
        .select('*, fiscal_documents(invoice_number, remitter, recipient, recipient_city, recipient_state, recipient_neighborhood, client_id, supplier_id, value, weight_kg, issue_date)')
        .in('load_id', loadIds)
        .order('created_at', { ascending: true });
      if (itemsErr) throw itemsErr;

      const clientIds = [...new Set((items || []).map((item) => item.fiscal_documents?.client_id).filter(Boolean))] as string[];
      const { data: clients, error: clientsError } = clientIds.length ? await supabase.rpc(
        'get_routing_client_locations_v1' as never,
        { _tenant_id: currentTenant.id, _client_ids: clientIds } as never,
      ) : { data: [], error: null };
      if (clientsError) throw clientsError;
      const routingClients = (clients || []) as unknown as RoutingClientLocation[];
      const addressByClient = new Map(routingClients.map((client) => [client.id,
        [client.address_street, client.address_number, client.address_complement, client.address_neighborhood,
          client.address_city, client.address_state, client.address_zip].filter(Boolean).join(', ')]));
      const locationByClient = new Map(routingClients.flatMap((client) =>
        client.address_geocode_status === 'verified' && client.address_lat != null && client.address_lng != null
          && client.address_geocode_hash ? [[client.id, {
            latitude: Number(client.address_lat), longitude: Number(client.address_lng),
            provider: client.address_geocode_provider || null, accuracy_m: client.address_geocode_accuracy_m ?? null,
            confidence: client.address_geocode_confidence ?? null, address_hash: client.address_geocode_hash,
          }] as const] : []));

      const byLoad: Record<string, RoutingLoadItem[]> = {};
      (items || []).forEach((it) => {
        (byLoad[it.load_id] ||= []).push({
          ...it,
          fiscal_documents: it.fiscal_documents ? {
            ...it.fiscal_documents,
            client_address: it.fiscal_documents.client_id ? addressByClient.get(it.fiscal_documents.client_id) || null : null,
            client_location: it.fiscal_documents.client_id ? locationByClient.get(it.fiscal_documents.client_id) || null : null,
          } : null,
          pallet_count: it.pallet_count ?? 0,
          weight_kg: it.weight_kg ?? 0,
          volume_m3: it.volume_m3 ?? 0,
        });
      });
      return loads.map(load => ({ ...load, items: byLoad[load.id] || [] })) as RoutingLoad[];
    },
    enabled: !!currentTenant,
  });
}
