import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import type { Tables } from '@/integrations/supabase/types';

export type TripOperationalEvent = Pick<
  Tables<'operational_events'>,
  | 'id'
  | 'tenant_id'
  | 'dispatch_trip_id'
  | 'load_id'
  | 'event_type'
  | 'severity'
  | 'description'
  | 'resolved_at'
  | 'created_at'
  | 'visible_to_client'
  | 'client_action_required'
  | 'public_status'
>;

export function readTripOperationalEvents(
  value: unknown,
  tenantId: string,
  tripId: string,
): TripOperationalEvent[] {
  if (!Array.isArray(value)) {
    throw new Error('A resposta das ocorrências da viagem é inválida.');
  }

  const valid = value.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const event = entry as Partial<TripOperationalEvent>;
    return typeof event.id === 'string'
      && event.tenant_id === tenantId
      && event.dispatch_trip_id === tripId
      && typeof event.event_type === 'string'
      && typeof event.severity === 'string'
      && typeof event.created_at === 'string'
      && typeof event.visible_to_client === 'boolean'
      && typeof event.client_action_required === 'boolean';
  });

  if (!valid) {
    throw new Error('Não foi possível confirmar o escopo das ocorrências da viagem.');
  }

  return value as TripOperationalEvent[];
}

export function useTripOperationalEvents(tripId: string | null) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();

  return useQuery({
    queryKey: ['trip-operational-events', currentTenant?.id, user?.id, tripId],
    queryFn: async ({ signal }): Promise<TripOperationalEvent[]> => {
      if (!currentTenant || !user || !tripId) return [];
      const { data, error } = await supabase
        .from('operational_events')
        .select('id, tenant_id, dispatch_trip_id, load_id, event_type, severity, description, resolved_at, created_at, visible_to_client, client_action_required, public_status')
        .eq('tenant_id', currentTenant.id)
        .eq('dispatch_trip_id', tripId)
        .order('created_at', { ascending: false })
        .limit(50)
        .abortSignal(signal);
      if (error) throw error;
      return readTripOperationalEvents(data, currentTenant.id, tripId);
    },
    enabled: !!currentTenant?.id && !!user?.id && !!tripId,
    retry: false,
    refetchInterval: tripId ? 10_000 : false,
  });
}
