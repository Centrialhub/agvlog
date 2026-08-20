import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';
import { useCallback } from 'react';

export interface DispatchRoutePayload {
  vehicle_id: string;
  driver_id: string;
  planned_start_at: string;
  route_name: string;
  load_ids: string[];
  stops: RouteStopDraft[];
  planning_draft_id?: string | null;
}

export function useDispatchRoutePlan() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();

  const dispatchOnce = useCallback(async (payload: DispatchRoutePayload): Promise<string> => {
    if (!currentTenant) throw new Error('Tenant não selecionado');
    const orderOf = (s: RouteStopDraft) =>
      s.manual_order ?? s.optimized_order ?? s.original_order ?? 9999;
    const stops = [...payload.stops]
        .sort((a, b) => orderOf(a) - orderOf(b))
        .map((s) => ({
          client_id: s.client_id,
          destination: s.destination,
          latitude: s.latitude ?? null,
          longitude: s.longitude ?? null,
          planned_arrival_at: s.planned_arrival_at,
          estimated_departure_at: s.estimated_departure_at,
          service_time_minutes: s.service_time_minutes,
          delivery_window_start: s.delivery_window_start,
          delivery_window_end: s.delivery_window_end,
          risk_level: s.risk_level,
          risk_reason: s.risk_reason,
          notes: s.notes,
          document_ids: s.fiscal_document_ids, // Mapped to document_ids for new RPC
        }));

    const { data, error } = await supabase.rpc('plan_dispatch_trip_v2', {
      p_tenant_id: currentTenant.id,
      p_driver_id: payload.driver_id,
      p_vehicle_id: payload.vehicle_id,
      p_load_ids: payload.load_ids,
      p_stops: stops,
      p_route_name: payload.route_name,
    });

    if (error) throw new Error(error.message || String(error));
    return data as string;
  }, [currentTenant]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['pending_loads_for_routing'] });
    qc.invalidateQueries({ queryKey: ['loads'] });
    qc.invalidateQueries({ queryKey: ['dispatch_trips'] });
    qc.invalidateQueries({ queryKey: ['route_planning_drafts'] });
    qc.invalidateQueries({ queryKey: ['driver_trip'] });
    qc.invalidateQueries({ queryKey: ['driver_active_trip'] });
    qc.invalidateQueries({ queryKey: ['driver_stops'] });
  }, [qc]);

  const mutation = useMutation({
    mutationFn: dispatchOnce,
    onSuccess: () => {
      invalidate();
    },
  });

  // Attach the bare callable for batch flows that need to handle navigation/toasts themselves.
  return Object.assign(mutation, { dispatchRoute: dispatchOnce, invalidateAll: invalidate });
}
