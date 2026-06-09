import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export interface RoutePlanningDraft {
  id: string;
  tenant_id: string;
  name: string;
  order_ids: string[] | null;
  vehicle_id: string | null;
  operational_route_id: string | null;
  notes: string | null;
  status: string;
  converted_load_id: string | null;
  created_at: string;
  updated_at: string;
  load_ids?: string[] | null;
  driver_id?: string | null;
  planned_start_at?: string | null;
  route_config?: any;
}

export function useRoutePlanningDrafts() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['route_planning_drafts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('route_planning_drafts')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'draft')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as RoutePlanningDraft[];
    },
    enabled: !!currentTenant,
  });
}

/**
 * Persiste um snapshot completo de uma rota planejada como rascunho.
 * Usa o id local da rota como id estável do draft (1 rota = 1 draft).
 * Armazena tudo em `route_config` (jsonb existente).
 */
export function useSavePlanSnapshot() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ routeId, name, snapshot }: { routeId: string; name: string; snapshot: any }) => {
      if (!currentTenant) return null;
      const loadIds: string[] = Array.isArray(snapshot?.loads)
        ? snapshot.loads.map((l: any) => l.id).filter(Boolean)
        : [];
      const payload: any = {
        id: routeId,
        tenant_id: currentTenant.id,
        name,
        load_ids: loadIds,
        order_ids: loadIds,
        vehicle_id: snapshot?.vehicle_id || null,
        driver_id: snapshot?.driver_id || null,
        planned_start_at: snapshot?.planned_start_at || null,
        notes: snapshot?.notes || null,
        route_config: snapshot,
        status: 'draft',
        created_by: user?.id,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('route_planning_drafts').upsert(payload as any, { onConflict: 'id' });
      if (error) throw error;
      return routeId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['route_planning_drafts'] }),
  });
}

export function useSaveDraft() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, orderIds, vehicleId, notes }: {
      id?: string; name: string; orderIds: string[]; vehicleId?: string | null; notes?: string;
    }) => {
      if (id) {
        const { data, error } = await supabase.from('route_planning_drafts').update({
          name,
          order_ids: orderIds as any,
          vehicle_id: vehicleId || null,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        } as any).eq('id', id).select().single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase.from('route_planning_drafts').insert({
          tenant_id: currentTenant!.id,
          name,
          order_ids: orderIds as any,
          vehicle_id: vehicleId || null,
          notes: notes || null,
          status: 'draft',
          created_by: user?.id,
        } as any).select().single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['route_planning_drafts'] }),
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('route_planning_drafts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['route_planning_drafts'] }),
  });
}
