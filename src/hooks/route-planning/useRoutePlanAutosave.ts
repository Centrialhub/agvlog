import {useEffect,useRef,type RefObject} from 'react';
import {DraftConflictError,type RoutePlanSnapshot,type useSavePlanSnapshot} from '@/hooks/useRoutePlanningDrafts';
import type {PendingDispatch} from '@/lib/route-planning/dispatchOutbox';

interface AutosaveRoute extends RoutePlanSnapshot {id:string;name:string;loads:Array<{id:string}>;dispatching?:boolean;deleting?:boolean}
export function useRoutePlanAutosave(routes:AutosaveRoute[],pending:PendingDispatch[],ready:RefObject<boolean>,
  saver:ReturnType<typeof useSavePlanSnapshot>,onConflict:()=>void,onSaveError:(error:Error)=>void=()=>{}){
  const handlers=useRef({saver,onConflict,onSaveError});handlers.current={saver,onConflict,onSaveError};
  const latest=useRef({routes,pending,ready});latest.current={routes,pending,ready};
  const saveRoute=(route:AutosaveRoute)=>handlers.current.saver.mutate({routeId:route.id,name:route.name,snapshot:{
    loads:route.loads.map(load=>({id:load.id})),load_ids:route.loads.map(load=>load.id),stops:route.stops,
    vehicle_id:route.vehicle_id,driver_id:route.driver_id,planned_start_at:route.planned_start_at,
    sortMode:route.sortMode,initial_transit_minutes:route.initial_transit_minutes,notes:route.notes,
  }},{onError:(error:Error)=>{
    if(error instanceof DraftConflictError){
      handlers.current.saver.forgetVersion(route.id);handlers.current.onConflict();return;
    }
    handlers.current.onSaveError(error);
  }});
  useEffect(()=>{
    if(!ready.current)return;
    const timers=routes.filter(route=>!route.dispatching && !route.deleting && !pending.some(item=>item.scope===route.id))
      .map(route=>setTimeout(()=>saveRoute(route),1500));
    return ()=>timers.forEach(clearTimeout);
  },[routes,pending,ready]);
  useEffect(()=>{
    const flush=()=>{
      const current=latest.current;
      if(!current.ready.current)return;
      current.routes.filter(route=>!route.dispatching && !route.deleting && !current.pending.some(item=>item.scope===route.id))
        .forEach(saveRoute);
    };
    window.addEventListener('pagehide',flush);
    return()=>{window.removeEventListener('pagehide',flush);flush();};
  },[]);
}
