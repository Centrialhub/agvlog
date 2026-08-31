import {useState} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useClientInvoiceLifecycle} from '@/hooks/useClientInvoiceLifecycle';
import {Button} from '@/components/ui/button';
import {invoiceActionLabels,invoiceError} from '@/lib/financial/clientInvoiceCommands';
export function ClientInvoiceRecoveryPanel(){
 const api=useClientInvoiceLifecycle();const {currentTenant}=useTenant();const {user}=useAuth();const scope=`${currentTenant?.id}:${user?.id}`;
 const [notice,setNotice]=useState({scope,message:''});const message=notice.scope===scope?notice.message:'';
 if(!api.pending&&!api.recoveryError&&!message)return null;
 return <section aria-label="Recuperação de faturas" className="mb-4 space-y-2 rounded border p-3">
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
  {api.pending?<><p>Fatura sem confirmação: {invoiceActionLabels[api.pending.payload.action]}. Não crie outro pedido.</p><Button disabled={api.isPending} onClick={async()=>{
   setNotice({scope,message:''});try{const result=await api.recover();setNotice({scope,message:`Pedido recuperado: ${invoiceActionLabels[result.action]} — fatura ${result.invoice_number}. Consulte o estado atual da fatura.`});}
   catch(cause){setNotice({scope,message:invoiceError(cause)});}
  }}>Recuperar pedido de fatura</Button></>:null}{message?<p role="status">{message}</p>:null}
 </section>;
}
