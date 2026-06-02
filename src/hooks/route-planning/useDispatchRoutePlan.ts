import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';

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

  return useMutation({
    mutationFn: async (payload: DispatchRoutePayload) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const stops = [...payload.stops]
        .sort((a, b) => (a.manual_order || 0) - (b.manual_order || 0))
        .map((s) => ({
          client_id: s.client_id,
          destination: s.destination,
          planned_arrival_at: s.planned_arrival_at,
          estimated_departure_at: s.estimated_departure_at,
          service_time_minutes: s.service_time_minutes,
          delivery_window_start: s.delivery_window_start,
          delivery_window_end: s.delivery_window_end,
          risk_level: s.risk_level,
          risk_reason: s.risk_reason,
          notes: s.notes,
          fiscal_document_ids: s.fiscal_document_ids,
          load_ids: s.load_ids,
        }));

      const { data, error } = await supabase.rpc('dispatch_planned_route' as any, {
        _payload: {
          tenant_id: currentTenant.id,
          vehicle_id: payload.vehicle_id,
          driver_id: payload.driver_id,
          planned_start_at: payload.planned_start_at,
          route_name: payload.route_name,
          load_ids: payload.load_ids,
          stops,
          planning_draft_id: payload.planning_draft_id || null,
        },
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending_loads_for_routing'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['dispatch_trips'] });
      qc.invalidateQueries({ queryKey: ['route_planning_drafts'] });
      qc.invalidateQueries({ queryKey: ['driver_trip'] });
      qc.invalidateQueries({ queryKey: ['driver_active_trip'] });
      qc.invalidateQueries({ queryKey: ['driver_stops'] });
    },
  });
}
