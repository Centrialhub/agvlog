import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';

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
  const { selectedClientId } = usePortalClientScope();
  return useQuery({
    queryKey: ['portal_pickups', currentTenant?.id, selectedClientId, filters],
    queryFn: async (): Promise<PortalPickup[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('list_client_pickups_v2', {
        _tenant_id: currentTenant.id,
        _client_id: selectedClientId ?? undefined,
        _status: filters?.status || undefined,
        _start_date: filters?.start || undefined,
        _end_date: filters?.end || undefined,
        _limit: 200,
        _offset: 0,
      });
      if (error) throw error;
      return data as PortalPickup[];
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
        _recipient_name: args.recipient_name || undefined,
        _notes: args.notes || undefined,
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
      const { error } = await supabase.rpc('cancel_client_pickup', {
        _tenant_id: currentTenant.id,
        _pickup_id: pickup_id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal_pickups'] }),
  });
}
