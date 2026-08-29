import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { useRef } from 'react';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import type { RouteStopDraft, RouteStopSortMode } from '@/lib/route-planning/routePlanningTypes';

export class DraftConflictError extends Error {
  constructor(public routeId: string, public expected: string | null, public actual: string | null) {
    super(`Draft ${routeId} foi modificado em outra aba/sessão (esperado=${expected}, atual=${actual}).`);
    this.name = 'DraftConflictError';
  }
}

export type RoutePlanningDraft = Tables<'route_planning_drafts'>;

export interface RoutePlanSnapshot {
  loads?: Array<{ id: string }>;
  load_ids?: string[];
  stops?: RouteStopDraft[];
  vehicle_id?: string;
  driver_id?: string;
  planned_start_at?: string;
  sortMode?: RouteStopSortMode;
  initial_transit_minutes?: number;
  notes?: string;
}

const toJson = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

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
  // Guarda otimista: rastreia updated_at conhecido por routeId.
  const versionsRef = useRef<Map<string, string>>(new Map());
  const mutation = useMutation({
    mutationFn: async ({ routeId, name, snapshot }: { routeId: string; name: string; snapshot: RoutePlanSnapshot }) => {
      if (!currentTenant) return null;
      const loadIds: string[] = Array.isArray(snapshot?.loads)
        ? snapshot.loads.map(load => load.id).filter(Boolean)
        : [];
      // 1. Leitura da versão atual no banco (se existir)
      const { data: existing, error: readErr } = await supabase
        .from('route_planning_drafts')
        .select('updated_at')
        .eq('id', routeId)
        .maybeSingle();
      if (readErr) throw readErr;
      const dbVersion = existing?.updated_at ?? null;
      const knownVersion = versionsRef.current.get(routeId) ?? null;
      // Só bloqueia se já rastreamos uma versão prévia e ela difere do banco.
      if (knownVersion && dbVersion && knownVersion !== dbVersion) {
        throw new DraftConflictError(routeId, knownVersion, dbVersion);
      }
      const nowIso = new Date().toISOString();
      const payload: TablesInsert<'route_planning_drafts'> = {
        id: routeId,
        tenant_id: currentTenant.id,
        name,
        load_ids: loadIds,
        order_ids: loadIds,
        vehicle_id: snapshot?.vehicle_id || null,
        driver_id: snapshot?.driver_id || null,
        planned_start_at: snapshot?.planned_start_at || null,
        notes: snapshot?.notes || null,
        route_config: toJson(snapshot),
        status: 'draft',
        created_by: user?.id,
        updated_at: nowIso,
      };
      const { data: saved, error } = await supabase
        .from('route_planning_drafts')
        .upsert(payload, { onConflict: 'id' })
        .select('id, updated_at')
        .single();
      if (error) throw error;
      const savedVersion = saved?.updated_at ?? nowIso;
      versionsRef.current.set(routeId, savedVersion);
      return routeId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['route_planning_drafts'] }),
  });
  return Object.assign(mutation, {
    seedVersion: (routeId: string, updatedAt: string | null | undefined) => {
      if (routeId && updatedAt) versionsRef.current.set(routeId, updatedAt);
    },
    forgetVersion: (routeId: string) => { versionsRef.current.delete(routeId); },
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
        const payload: TablesUpdate<'route_planning_drafts'> = {
          name,
          order_ids: orderIds,
          vehicle_id: vehicleId || null,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await supabase.from('route_planning_drafts').update(payload).eq('id', id).select().single();
        if (error) throw error;
        return data;
      } else {
        const payload: TablesInsert<'route_planning_drafts'> = {
          tenant_id: currentTenant!.id,
          name,
          order_ids: orderIds,
          vehicle_id: vehicleId || null,
          notes: notes || null,
          status: 'draft',
          created_by: user?.id,
        };
        const { data, error } = await supabase.from('route_planning_drafts').insert(payload).select().single();
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
