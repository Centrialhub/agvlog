import {useState} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useSettlementAdjustment} from '@/hooks/useSettlementAdjustment';
import {settlementAdjustmentError} from '@/lib/financial/settlementAdjustmentCommands';
import {Button} from '@/components/ui/button';
export function SettlementAdjustmentRecovery({api}:{api:ReturnType<typeof useSettlementAdjustment>}){
 const {currentTenant}=useTenant();const {user}=useAuth();const scope=currentTenant?.id+':'+user?.id;
 const [notice,setNotice]=useState({scope,message:''});const message=notice.scope===scope?notice.message:'';
 if(!api.pending&&!api.recoveryError&&!message)return null;
 return <section aria-label="Recuperação de ajustes do acerto" className="mb-4 space-y-2 rounded border p-3">
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
  {api.pending?<><p>Ajuste sem confirmação: {api.pending.payload.action==='add'?'inclusão':'remoção'} no acerto {api.pending.payload.settlement_id}. Recupere o pedido existente.</p>
   <Button disabled={api.isPending} onClick={async()=>{setNotice({scope,message:''});try{await api.recover();setNotice({scope,message:'Ajuste recuperado. Consulte o estado atual do acerto.'});}
    catch(cause){setNotice({scope,message:settlementAdjustmentError(cause)});}}}>Recuperar ajuste do acerto</Button></>:null}
  {message?<p role="status">{message}</p>:null}
 </section>;
}
export function SettlementAdjustmentRecoveryPanel(){const api=useSettlementAdjustment();return <SettlementAdjustmentRecovery api={api}/>;}
