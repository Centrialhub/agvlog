import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { useRef } from 'react';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import type { RouteStopDraft, RouteStopSortMode } from '@/lib/route-planning/routePlanningTypes';
import {
  callRouteDraftRpc,
  parseRouteDraftDeleteContext,
  parseRouteDraftDeleteResult,
  routeDraftDeleteCommandSchema,
  type RouteDraftDeleteResult,
} from '@/lib/route-planning/draftDeleteCommand';

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
      if (!currentTenant || !user) throw new Error('Sessão não autenticada');
      const loadIds: string[] = Array.isArray(snapshot?.loads)
        ? snapshot.loads.map(load => load.id).filter(Boolean)
        : [];
      // 1. Leitura da versão atual no banco (se existir)
      const { data: existing, error: readErr } = await supabase
        .from('route_planning_drafts')
        .select('updated_at, status')
        .eq('id', routeId)
        .eq('tenant_id', currentTenant.id)
        .maybeSingle();
      if (readErr) throw readErr;
      const dbVersion = existing?.updated_at ?? null;
      const knownVersion = versionsRef.current.get(routeId) ?? null;
      // Só bloqueia se já rastreamos uma versão prévia e ela difere do banco.
      if (existing && existing.status !== 'draft' || knownVersion && knownVersion !== dbVersion) {
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
      // Compare-and-swap is part of the UPDATE, not just a preceding SELECT.
      // A delayed autosave must never restore a dispatched draft to "draft".
      const updates:TablesUpdate<'route_planning_drafts'>={...payload};
      delete updates.id;delete updates.tenant_id;delete updates.created_by;delete updates.status;
      const write=existing
        ? supabase.from('route_planning_drafts').update(updates).eq('id',routeId)
          .eq('tenant_id',currentTenant.id).eq('status','draft')
          .eq('updated_at',dbVersion!)
        : supabase.from('route_planning_drafts').insert(payload);
      const { data: saved, error } = await write.select('id, updated_at').maybeSingle();
      if (error) throw error;
      if (!saved) throw new DraftConflictError(routeId,dbVersion,null);
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

export function useDeleteDraft() {
  const qc = useQueryClient();
  const {currentTenant}=useTenant();
  const {user}=useAuth();
  return useMutation({
    mutationFn: async ({id,requestId}:{id:string;requestId:string}):Promise<RouteDraftDeleteResult> => {
      if(!currentTenant||!user)throw new Error('Sessão não autenticada');
      const contextResponse=await callRouteDraftRpc('get_route_planning_draft_delete_context_v1',{
        _tenant_id:currentTenant.id,_draft_id:id,
      });
      if(contextResponse.error)throw contextResponse.error;
      const context=parseRouteDraftDeleteContext(contextResponse.data,currentTenant.id,user.id,id);
      if(context.exists&&!context.can_delete)throw new DraftConflictError(id,context.revision,context.revision);
      const payload=routeDraftDeleteCommandSchema.parse({version:1,tenant_id:currentTenant.id,actor_id:user.id,
        request_id:requestId,draft_id:id,expected_revision:context.revision});
      const send=()=>callRouteDraftRpc('delete_route_planning_draft_v1',{_payload:payload});
      let response=await send();
      if(response.error&&/fetch|network|connection|timeout/i.test(String((response.error as {message?:unknown})?.message??response.error)))response=await send();
      if(response.error)throw response.error;
      return parseRouteDraftDeleteResult(response.data,payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['route_planning_drafts'] }),
    onError: () => qc.invalidateQueries({ queryKey: ['route_planning_drafts'] }),
  });
}
