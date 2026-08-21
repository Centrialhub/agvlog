import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';
import { useCallback } from 'react';
import { isFeatureEnabled } from '@/lib/featureFlags';

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
        .map((s, idx) => ({
          destination: s.destination,
          client_id: s.client_id,
          stop_order: idx + 1,
          document_ids: s.fiscal_document_ids || [],
        }));

    if (isFeatureEnabled('LOGISTICS_CONSOLIDATION_V2')) {
      const { data, error } = await (supabase.rpc as any)('plan_dispatch_trip_v3', {
        p_tenant_id: currentTenant.id,
        p_idempotency_key: payload.planning_draft_id || crypto.randomUUID(),
        p_driver_id: payload.driver_id,
        p_vehicle_id: payload.vehicle_id,
        p_route_name: payload.route_name,
        p_load_ids: payload.load_ids,
        p_stops: stops,
      });

      if (error) throw new Error(error.message || String(error));
      return data as string;
    } else {
      const { data, error } = await supabase.rpc('dispatch_planned_route', {
        _payload: {
          tenant_id: currentTenant.id,
          driver_id: payload.driver_id,
          vehicle_id: payload.vehicle_id,
          route_name: payload.route_name,
          load_ids: payload.load_ids,
          stops: stops,
          idempotency_key: payload.planning_draft_id || null,
        }
      });

      if (error) throw new Error(error.message || String(error));
      return (data as any)?.id || data;
    }
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
