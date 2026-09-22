import {useCallback,useEffect,useRef,useState} from 'react';
import {parsePayableAction,submitPayableAction,payableActionError,PayableActionRejected,type PayableAction} from '@/lib/financial/payableActions';

export function usePayableAction(tenant:string,actor:string,scope:string,onRecorded:()=>void){
 const key=`agvlog:payable-action:v1:${tenant}:${actor}:${scope}`;
 const [pending,setPending]=useState<PayableAction|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false);
 const sending=useRef(false),active=useRef(true);
 const read=useCallback(()=>{const raw=localStorage.getItem(key);if(!raw)return null;const command=parsePayableAction(JSON.parse(raw));if(command.tenant_id!==tenant||('payable_id' in command?scope!==command.payable_id:scope!=='archive'))throw new Error('Pedido salvo fora desta conta.');return command;},[key,tenant,scope]);
 useEffect(()=>{active.current=true;function sync(){try{setPending(read());setBlocked(false);}catch{setBlocked(true);setError('Não foi possível recuperar o pedido salvo. Não inicie outro pagamento neste navegador.');}}sync();const listener=(e:StorageEvent)=>{if(e.key===key||e.key===null)sync();};window.addEventListener('storage',listener);return()=>{active.current=false;window.removeEventListener('storage',listener);};},[key,read]);
 async function send(candidate?:PayableAction){
  if(sending.current||blocked)return;
  sending.current=true;setBusy(true);setError('');
  try{
   if(!navigator.locks)throw new Error('Este navegador não permite proteger a retomada. Use um navegador atualizado.');
   await navigator.locks.request(key,async()=>{
    const previous=read(),command=previous||candidate;
    if(!command)throw new Error('Nenhum pedido para confirmar.');
    parsePayableAction(command);localStorage.setItem(key,JSON.stringify(command));if(active.current)setPending(command);
    try{await submitPayableAction(command);}catch(cause){
     // These business rejections run after the server checks the committed request.
     // Access loss or a request-id conflict cannot establish an earlier outcome.
     if(cause instanceof PayableActionRejected&&(!previous||['22023','23514','55000','40001'].includes(cause.code))){localStorage.removeItem(key);if(active.current)setPending(null);}throw cause;
    }
    localStorage.removeItem(key);if(active.current){setPending(null);onRecorded();}
   });
  }catch(cause){if(active.current)setError(payableActionError(cause));}
  finally{sending.current=false;if(active.current)setBusy(false);}
 }
 return {pending,error,busy,blocked,send};
}
