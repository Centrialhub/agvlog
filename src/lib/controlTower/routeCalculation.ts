import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { requestWithDeadline } from '@/lib/requestWithDeadline';
const id=z.string().uuid();
const receipt=z.object({ok:z.literal(true),request_id:id,trip_id:id,route_id:id,calculated_at:z.string().datetime({offset:true}),
  distance_meters:z.number().finite().nonnegative(),duration_seconds:z.number().finite().nonnegative(),waypoint_count:z.number().int().min(2)});
const errorBody=z.object({error:z.string().optional(),code:z.string().optional()});
const pending=new Map<string,Promise<z.infer<typeof receipt>>>();

// Persist only a request UUID, never coordinates/tokens/provider payloads. A lost
// response is recovered with the same server receipt after remount/reload.
export function calculateTripRoute(tenantId:string,actorId:string,tripId:string) {
  [tenantId,actorId,tripId].forEach(value=>id.parse(value));
  const key=`agvlog:route:v1:${tenantId}:${actorId}:${tripId}`;
  const existing=pending.get(key);if(existing)return existing;
  const task=calculate(key,tenantId,actorId,tripId).finally(()=>{pending.delete(key);});pending.set(key,task);return task;
}
async function calculate(key:string,tenantId:string,actorId:string,tripId:string) {
  let requestId:string;
  try {
    const saved=localStorage.getItem(key);
    if(saved && !id.safeParse(saved).success)throw new Error('Invalid saved route request');
    requestId=saved || crypto.randomUUID();localStorage.setItem(key,requestId);
    if(localStorage.getItem(key)!==requestId)throw new Error('Request not persisted');
  }catch{throw new Error('Não foi possível preservar a solicitação neste navegador. Nenhum cálculo foi enviado.');}
  const {result,detail}=await requestWithDeadline(async signal=>{
    const result=await supabase.functions.invoke('calculate-trip-route',{body:{trip_id:tripId,request_id:requestId,tenant_id:tenantId,actor_id:actorId},signal});
    let detail:unknown=result.data;
    if(result.error?.context instanceof Response){try{detail=await result.error.context.clone().json();}catch{/* Unknown outcome stays pending. */}}
    return {result,detail};
  });
  const parsed=receipt.safeParse(result.data);
  if(!result.error && parsed.success && parsed.data.request_id===requestId && parsed.data.trip_id===tripId){
    // A storage cleanup error cannot turn a committed route into a failed write.
    try{if(localStorage.getItem(key)===requestId)localStorage.removeItem(key);}catch{/* Same receipt remains recoverable. */}
    return parsed.data;
  }
  const failure=errorBody.safeParse(detail);
  if(failure.success){
    if(failure.data.code==='route_context_changed'){
      try{if(localStorage.getItem(key)===requestId)localStorage.removeItem(key);}catch{/* Safe replay will still reject the expired context. */}
    }
    if(failure.data.error)throw new Error(failure.data.error);
  }
  throw new Error('Confirmação pendente. Tente novamente para consultar a mesma solicitação, sem duplicar a gravação.');
}
