import {useState} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useReceivableFinancial} from '@/hooks/useReceivableFinancial';
import {Button} from '@/components/ui/button';
import {financialActionLabels,financialError} from '@/lib/financial/receivableCommands';
export function ReceivableFinancialRecoveryPanel(){
 const api=useReceivableFinancial();const {currentTenant}=useTenant();const {user}=useAuth();const scope=`${currentTenant?.id}:${user?.id}`;
 const [notice,setNotice]=useState({scope,message:''});const message=notice.scope===scope?notice.message:'';
 if(!api.pending&&!api.recoveryError&&!message)return null;
 return <section aria-label="Recuperação de operações financeiras" className="mb-4 space-y-2 rounded border p-3">
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
  {api.pending?<><p>Operação sem confirmação: {financialActionLabels[api.pending.payload.action]}. Não repita com outro pedido.</p><Button disabled={api.isPending} onClick={async()=>{
   setNotice({scope,message:''});try{const result=await api.recover();setNotice({scope,message:`Operação recuperada: ${financialActionLabels[result.action]}. Consulte os saldos atuais no título.`});}
   catch(cause){setNotice({scope,message:financialError(cause)});}
  }}>Recuperar operação financeira</Button></>:null}{message?<p role="status">{message}</p>:null}
 </section>;
}
