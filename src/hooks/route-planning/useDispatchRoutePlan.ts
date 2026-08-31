import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDispatchOutbox, DISPATCH_OUTBOX_CHANGED, pendingDispatches, type PendingDispatch } from '@/lib/route-planning/dispatchOutbox';
import { invalidateTripLoadQueries, tripMutationError } from '@/lib/tripMutation';

export interface DispatchRoutePayload {
  attempt_scope: string;
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
  const { user } = useAuth();
  const qc = useQueryClient();
  const tenantId=currentTenant?.id;const actorId=user?.id;
  const contextRef=useRef({tenantId,actorId});contextRef.current={tenantId,actorId};
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const refresh=()=>setRevision(value=>value+1);
    window.addEventListener('storage',refresh);window.addEventListener(DISPATCH_OUTBOX_CHANGED,refresh);
    return ()=>{window.removeEventListener('storage',refresh);window.removeEventListener(DISPATCH_OUTBOX_CHANGED,refresh);};
  },[]);
  const outbox=useMemo(()=>createDispatchOutbox({
    // Getters defer blocked-storage errors until an explicit read/send.
    get storage(){return window.localStorage;},uuid:()=>crypto.randomUUID(),
    lock:async(key,work)=>{
      if(!navigator.locks)throw new Error('Use um navegador atualizado em conexão segura para recuperar despachos entre abas.');
      return navigator.locks.request(key,work);
    },
    assertContext:()=>{
      if(contextRef.current.tenantId!==tenantId || contextRef.current.actorId!==actorId)
        throw new Error('A sessão ou empresa mudou. Atualize antes de continuar.');
    },
    changed:()=>window.dispatchEvent(new Event(DISPATCH_OUTBOX_CHANGED)),
    send:async payload=>{
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30_000);
      try{return await supabase.rpc('dispatch_planned_route',{_payload:JSON.parse(JSON.stringify(payload))}).abortSignal(controller.signal);}
      finally{clearTimeout(timer);}
    },
  }),[tenantId,actorId]);
  const pending=useMemo(()=>{
    try{return {items:tenantId && actorId?pendingDispatches(window.localStorage,tenantId,actorId):[],error:null};}
    catch(error){return {items:[] as PendingDispatch[],error:error instanceof Error?error.message:'Falha na recuperação local.'};}
  },[tenantId,actorId,revision]);
  const invalidate = useCallback(async () => {
    await Promise.allSettled([invalidateTripLoadQueries(qc),qc.invalidateQueries({queryKey:['route_planning_drafts']})]);
  }, [qc]);

  const dispatchOnce = useCallback(async (payload: DispatchRoutePayload): Promise<string> => {
    if (!tenantId) throw new Error('Tenant não selecionado');
    if (!actorId) throw new Error('Sessão não autenticada');
    const timestamp=(value:string|null|undefined)=>{
      if(!value)return null;
      const parsed=new Date(value);
      if(!Number.isFinite(parsed.getTime()))throw new Error('Informe uma data e hora válidas para o planejamento.');
      // datetime-local is in the operator's local zone; timestamptz must receive
      // an explicit offset rather than interpreting it in the database zone.
      return parsed.toISOString();
    };
    const plannedStart=timestamp(payload.planned_start_at);
    if(!plannedStart)throw new Error('Informe o horário previsto de saída.');
    const orderOf = (s: RouteStopDraft) =>
      s.manual_order ?? s.optimized_order ?? s.original_order ?? 9999;
    const stops = [...payload.stops]
        .sort((a, b) => orderOf(a) - orderOf(b))
        .map((s) => ({
          client_id: s.client_id,
          destination: s.destination,
          latitude: s.latitude ?? null,
          longitude: s.longitude ?? null,
          planned_arrival_at: timestamp(s.planned_arrival_at),
          estimated_departure_at: timestamp(s.estimated_departure_at),
          service_time_minutes: s.service_time_minutes,
          delivery_window_start: s.delivery_window_start,
          delivery_window_end: s.delivery_window_end,
          risk_level: s.risk_level,
          risk_reason: s.risk_reason,
          notes: s.notes,
          fiscal_document_ids: s.fiscal_document_ids,
          load_ids: s.load_ids,
        }));

    try{return await outbox.dispatch(tenantId,actorId,payload.attempt_scope,{
          tenant_id: tenantId,
          vehicle_id: payload.vehicle_id,
          driver_id: payload.driver_id,
          planned_start_at: plannedStart,
          route_name: payload.route_name,
          load_ids: payload.load_ids,
          stops,
          planning_draft_id: payload.planning_draft_id || null,
    });}catch(error){throw tripMutationError(error);}finally{await invalidate();}
  }, [tenantId,actorId,outbox,invalidate]);
  const recoverDispatch=useCallback(async(scope:string)=>{
    if(!tenantId || !actorId)throw new Error('Sessão não autenticada');
    try{return await outbox.recover(tenantId,actorId,scope);}
    catch(error){throw tripMutationError(error);}finally{await invalidate();}
  },[tenantId,actorId,outbox,invalidate]);

  const mutation = useMutation({
    mutationFn: dispatchOnce,
    retry: false,
  });

  // Attach the bare callable for batch flows that need to handle navigation/toasts themselves.
  return Object.assign(mutation, { dispatchRoute: dispatchOnce, recoverDispatch, pendingDispatches:pending.items,
    recoveryError:pending.error, invalidateAll: invalidate });
}
