import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface PortalPickup {
  id: string;
  pickup_number: string;
  remitter_name: string | null;
  remitter_cnpj: string | null;
  recipient_name: string | null;
  pickup_at: string;
  status: string;
  notes: string | null;
  linked_docs_count: number;
}

export function usePortalPickups(filters?: { status?: string; start?: string; end?: string }) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['portal_pickups', currentTenant?.id, filters],
    queryFn: async (): Promise<PortalPickup[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('list_client_pickups', {
        _tenant_id: currentTenant.id,
        _status: filters?.status || null,
        _start_date: filters?.start || null,
        _end_date: filters?.end || null,
        _limit: 200,
        _offset: 0,
      });
      if (error) throw error;
      return (data as any[]) as PortalPickup[];
    },
    enabled: !!currentTenant,
  });
}

export function useRequestPortalPickup() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { client_id: string; pickup_at: string; recipient_name?: string; notes?: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.rpc('request_client_pickup', {
        _tenant_id: currentTenant.id,
        _client_id: args.client_id,
        _pickup_at: args.pickup_at,
        _recipient_name: args.recipient_name || null,
        _notes: args.notes || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal_pickups'] }),
  });
}

export function useCancelPortalPickup() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pickup_id: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase.rpc('cancel_client_pickup' as any, {
        _tenant_id: currentTenant.id,
        _pickup_id: pickup_id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal_pickups'] }),
  });
}