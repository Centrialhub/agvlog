import {useState} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useClosingLifecycle} from '@/hooks/useClosingLifecycle';
import {Button} from '@/components/ui/button';
import {closingActionLabels,closingLifecycleError} from '@/lib/closingReports/closingLifecycle';
export function ClosingLifecycleRecoveryPanel(){
 const api=useClosingLifecycle();const {currentTenant}=useTenant();const {user}=useAuth();const scope=`${currentTenant?.id}:${user?.id}`;
 const [notice,setNotice]=useState({scope,message:''});const message=notice.scope===scope?notice.message:'';
 if(!api.pending&&!api.recoveryError&&!message)return null;
 return <section aria-label="Recuperação de transições de fechamento" className="mb-4 space-y-2 rounded border p-3">
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
  {api.pending?<><p>Ação sem confirmação: {closingActionLabels[api.pending.payload.action]}. Não repita com outro pedido.</p><Button disabled={api.isPending} onClick={async()=>{
   setNotice({scope,message:''});try{const result=await api.recover();setNotice({scope,message:`Transição recuperada: ${closingActionLabels[result.action]} — ${result.closing_number}. Consulte o estado atual na lista.`});}
   catch(cause){setNotice({scope,message:closingLifecycleError(cause)});}
  }}>Recuperar transição</Button></>:null}{message?<p role="status">{message}</p>:null}
 </section>;
}
