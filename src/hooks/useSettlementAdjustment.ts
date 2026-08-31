import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import {parseSettlementAdjustmentContext,settlementAdjustmentError,type SettlementAdjustmentInput,type SettlementAdjustmentResult} from '@/lib/financial/settlementAdjustmentCommands';
import {SETTLEMENT_ADJUSTMENT_CHANGED,createSettlementAdjustmentOutbox,pendingSettlementAdjustment} from '@/lib/financial/settlementAdjustmentOutbox';
const invalidations=['settlement-adjustment-context','driver_settlements','driver_settlement','driver_expenses','financial_obligations'];
export function useSettlementAdjustment(settlement?:string){
 const {user}=useAuth();const {currentTenant}=useTenant();const actor=user?.id,tenant=currentTenant?.id;const client=useQueryClient();
 const latest=useRef({actor,tenant});latest.current={actor,tenant};const alive=useRef(true),busy=useRef(false);const [isPending,setPending]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{alive.current=true;const changed=()=>setRevision(n=>n+1);window.addEventListener('storage',changed);window.addEventListener(SETTLEMENT_ADJUSTMENT_CHANGED,changed);
  return()=>{alive.current=false;window.removeEventListener('storage',changed);window.removeEventListener(SETTLEMENT_ADJUSTMENT_CHANGED,changed);};},[]);
 const assertContext=useCallback(()=>{if(!alive.current||latest.current.actor!==actor||latest.current.tenant!==tenant)throw new Error('A sessão ou empresa mudou. Recupere o ajuste na sessão original.');},[actor,tenant]);
 const query=useQuery({queryKey:['settlement-adjustment-context',tenant,actor,settlement],enabled:!!tenant&&!!actor&&!!settlement,retry:false,
  queryFn:async({signal})=>{const {data,error}=await supabase.rpc('get_driver_settlement_adjustment_context',{_tenant_id:tenant!,_settlement_id:settlement!}).abortSignal(signal);
   if(error)throw new Error(settlementAdjustmentError(error));assertContext();return parseSettlementAdjustmentContext(data,tenant!,actor!,settlement!);}});
 const outbox=useMemo(()=>createSettlementAdjustmentOutbox({get storage(){return window.localStorage;},uuid:()=>crypto.randomUUID(),assertContext,
  changed:()=>window.dispatchEvent(new Event(SETTLEMENT_ADJUSTMENT_CHANGED)),lock:async(key,work)=>{if(!navigator.locks)throw new Error('Use navegador atualizado em conexão segura para ajustar acertos.');return navigator.locks.request(key,work);},
  send:async payload=>{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
   try{return await supabase.rpc('apply_driver_settlement_adjustment',{_payload:JSON.parse(JSON.stringify(payload))}).abortSignal(controller.signal);}finally{clearTimeout(timeout);}}
 }),[assertContext]);
 const recovery=useMemo(()=>{try{return {revision,pending:tenant&&actor?pendingSettlementAdjustment(window.localStorage,tenant,actor):null,error:null};}
  catch(cause){return {revision,pending:null,error:settlementAdjustmentError(cause)};}},[tenant,actor,revision]);
 const run=async(work:()=>Promise<SettlementAdjustmentResult>)=>{
  if(!tenant||!actor)throw new Error('Entre e selecione a empresa.');if(busy.current)throw new Error('Aguarde o ajuste em andamento.');assertContext();busy.current=true;setPending(true);
  try{const result=await work();assertContext();return result;}catch(cause){throw new Error(settlementAdjustmentError(cause));}
  finally{await Promise.allSettled(invalidations.map(key=>client.invalidateQueries({queryKey:[key]})));busy.current=false;if(alive.current)setPending(false);}
 };
 return {query,isPending,pending:recovery.pending,recoveryError:recovery.error,submit:(input:SettlementAdjustmentInput)=>run(()=>outbox.submit(tenant!,actor!,input)),recover:()=>run(()=>outbox.recover(tenant!,actor!))};
}
