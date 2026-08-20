import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useTenant } from './useTenant';
import { useCurrentDriver } from './useCurrentDriver';
import { useDriverSync } from './useDriverSync';

export interface DriverWorkspace {
  has_active_trip: boolean;
  trip?: {
    id: string;
    status: string;
    start_km: number | null;
    created_at: string;
    vehicle_id: string | null;
  };
  loads: Array<{
    id: string;
    load_number: string;
    status: string;
    origin: string | null;
    destination: string | null;
    total_value: number;
    total_weight: number;
  }>;
  stops: Array<{
    id: string;
    stop_order: number;
    status: string;
    stop_type: string;
    location_name: string;
    address: string | null;
    arrival_time: string | null;
    departure_time: string | null;
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    documents: Array<{
      id: string;
      number: string;
      series: string | null;
      total_value: number;
      stop_status: string;
    }>;
  }>;
  progress: {
    total_stops: number;
    completed_stops: number;
    pending_stops: number;
  };
  next_action: {
    stop_id: string;
    stop_type: string;
    status: string;
    location_name: string;
  } | null;
}

export function useDriverWorkspace() {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const { data: driver } = useCurrentDriver();

  return useQuery({
    queryKey: ['driver_workspace', driver?.id, currentTenant?.id],
    queryFn: async (): Promise<DriverWorkspace | null> => {
      if (!driver || !currentTenant) return null;
      
      const { data, error } = await supabase.rpc('get_driver_workspace_v1', {
        p_driver_id: driver.id,
        p_tenant_id: currentTenant.id
      });

      if (error) {
        console.error('[useDriverWorkspace] RPC Error:', error);
        throw error;
      }

      return data as unknown as DriverWorkspace;
    },
    enabled: !!driver && !!currentTenant,
    refetchInterval: 30000,
  });
}

export type DriverEventType = 
  | 'arrival' 
  | 'departure' 
  | 'delivery_success' 
  | 'delivery_refusal' 
  | 'delivery_partial'
  | 'trip_start' 
  | 'trip_end';

export interface PodData {
  receiver_name: string;
  receiver_tax_id?: string;
  signed_at?: string;
  photo_url?: string;
  signature_url?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  [key: string]: any;
}

export function useDriverExecution() {
  const queryClient = useQueryClient();
  const { currentTenant } = useTenant();
  const { data: driver } = useCurrentDriver();
  const { addToOutbox } = useDriverSync();

  const reportEvent = useMutation({
    mutationFn: async ({
      tripId,
      stopId,
      eventType,
      payload = {},
      podData,
      idempotencyKey
    }: {
      tripId: string;
      stopId?: string;
      eventType: DriverEventType;
      payload?: any;
      podData?: PodData;
      idempotencyKey?: string;
    }) => {
      if (!driver || !currentTenant) throw new Error('Missing driver or tenant context');

      const finalIdempotencyKey = idempotencyKey || `${driver.id}-${eventType}-${Date.now()}`;

      // If offline, add to outbox and return early
      if (!navigator.onLine) {
        addToOutbox({
          tripId,
          stopId,
          eventType,
          payload,
          idempotencyKey: finalIdempotencyKey
        });
        return { offline: true };
      }

      // Use the new unified operational event RPC
      const { data, error } = await supabase.rpc('log_operational_event_v2', {
        p_tenant_id: currentTenant.id,
        p_event_type: eventType,
        p_dispatch_stop_id: stopId || undefined,
        p_payload: { ...payload, trip_id: tripId },
        p_pod_data: podData || undefined,
        p_idempotency_key: finalIdempotencyKey
      });

      if (error) throw error;

      // Legacy state transition RPC
      await supabase.rpc('driver_report_event_v1', {
        p_driver_id: driver.id,
        p_tenant_id: currentTenant.id,
        p_trip_id: tripId,
        p_stop_id: stopId || null, 
        p_event_type: eventType === 'delivery_success' ? 'delivery_complete' : eventType,
        p_payload: payload || {},
        p_idempotency_key: `${finalIdempotencyKey}-state`
      });


      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver_workspace'] });
    }
  });

  return { reportEvent };
}