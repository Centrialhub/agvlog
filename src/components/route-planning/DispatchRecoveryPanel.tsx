import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {useDispatchRoutePlan} from '@/hooks/route-planning/useDispatchRoutePlan';
import type {PendingDispatch} from '@/lib/route-planning/dispatchOutbox';

export default function DispatchRecoveryPanel({loadId,onConfirmed}:{loadId?:string;onConfirmed?:(item:PendingDispatch,tripId:string)=>void}){
  const dispatch=useDispatchRoutePlan();const [busy,setBusy]=useState<string|null>(null);const [error,setError]=useState('');
  const items=dispatch.pendingDispatches.filter(item=>!loadId || item.payload.load_ids.includes(loadId));
  if(!items.length && !dispatch.recoveryError)return null;
  return <section aria-label="Recuperação de despachos" className="rounded-lg border border-warning p-4 space-y-2">
    <h2 className="font-semibold">Despachos sem confirmação</h2>
    <p className="text-sm">A resposta pode ter sido perdida. Recupere a solicitação original antes de criar outra rota. O plano salvo será reenviado sem alterações.</p>
    {items.map(item=><div key={item.scope} className="flex items-center justify-between gap-3">
      <span className="text-sm">{item.payload.route_name} · {item.payload.load_ids.length} carga(s)</span>
      <Button variant="outline" disabled={busy!==null} onClick={async()=>{
        setBusy(item.scope);setError('');
        try{const trip=await dispatch.recoverDispatch(item.scope);onConfirmed?.(item,trip);}
        catch(caught){setError(caught instanceof Error?caught.message:'Não foi possível confirmar. Tente novamente.');}
        finally{setBusy(null);}
      }}>{busy===item.scope?'Recuperando…':'Recuperar despacho'}</Button>
    </div>)}
    {error || dispatch.recoveryError?<p role="alert" className="text-sm text-destructive">{error || dispatch.recoveryError}</p>:null}
  </section>;
}
