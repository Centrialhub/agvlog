import {useEffect,useRef,type RefObject} from 'react';
import {DraftConflictError,type RoutePlanSnapshot,type useSavePlanSnapshot} from '@/hooks/useRoutePlanningDrafts';
import type {PendingDispatch} from '@/lib/route-planning/dispatchOutbox';

interface AutosaveRoute extends RoutePlanSnapshot {id:string;name:string;loads:Array<{id:string}>;dispatching?:boolean}
export function useRoutePlanAutosave(routes:AutosaveRoute[],pending:PendingDispatch[],ready:RefObject<boolean>,
  saver:ReturnType<typeof useSavePlanSnapshot>,onConflict:()=>void){
  const handlers=useRef({saver,onConflict});handlers.current={saver,onConflict};
  useEffect(()=>{
    if(!ready.current)return;
    const timers=routes.filter(route=>!route.dispatching && !pending.some(item=>item.scope===route.id)).map(route=>setTimeout(()=>{
      handlers.current.saver.mutate({routeId:route.id,name:route.name,snapshot:{
        loads:route.loads.map(load=>({id:load.id})),load_ids:route.loads.map(load=>load.id),stops:route.stops,
        vehicle_id:route.vehicle_id,driver_id:route.driver_id,planned_start_at:route.planned_start_at,
        sortMode:route.sortMode,initial_transit_minutes:route.initial_transit_minutes,notes:route.notes,
      }},{onError:(error:Error)=>{
        if(error instanceof DraftConflictError){
          handlers.current.saver.forgetVersion(route.id);handlers.current.onConflict();
        }
      }});
    },1500));
    return ()=>timers.forEach(clearTimeout);
  },[routes,pending,ready]);
}
