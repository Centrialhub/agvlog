import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { useRef } from 'react';

export class DraftConflictError extends Error {
  constructor(public routeId: string, public expected: string | null, public actual: string | null) {
    super(`Draft ${routeId} foi modificado em outra aba/sessão (esperado=${expected}, atual=${actual}).`);
    this.name = 'DraftConflictError';
  }
}

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
  // Guarda otimista: rastreia updated_at conhecido por routeId.
  const versionsRef = useRef<Map<string, string>>(new Map());
  const mutation = useMutation({
    mutationFn: async ({ routeId, name, snapshot }: { routeId: string; name: string; snapshot: any }) => {
      if (!currentTenant) return null;
      const loadIds: string[] = Array.isArray(snapshot?.loads)
        ? snapshot.loads.map((l: any) => l.id).filter(Boolean)
        : [];
      // 1. Leitura da versão atual no banco (se existir)
      const { data: existing, error: readErr } = await supabase
        .from('route_planning_drafts')
        .select('updated_at')
        .eq('id', routeId)
        .maybeSingle();
      if (readErr) throw readErr;
      const dbVersion = (existing as any)?.updated_at ?? null;
      const knownVersion = versionsRef.current.get(routeId) ?? null;
      // Só bloqueia se já rastreamos uma versão prévia e ela difere do banco.
      if (knownVersion && dbVersion && knownVersion !== dbVersion) {
        throw new DraftConflictError(routeId, knownVersion, dbVersion);
      }
      const nowIso = new Date().toISOString();
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
        updated_at: nowIso,
      };
      const { data: saved, error } = await supabase
        .from('route_planning_drafts')
        .upsert(payload as any, { onConflict: 'id' })
        .select('id, updated_at')
        .single();
      if (error) throw error;
      const savedVersion = (saved as any)?.updated_at ?? nowIso;
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
