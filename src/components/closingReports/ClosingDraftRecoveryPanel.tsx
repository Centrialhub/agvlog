import {useState} from 'react';
import {useAuth} from '@/hooks/useAuth';import {useTenant} from '@/hooks/useTenant';import {useClosingDraftWrites} from '@/hooks/useClosingDraftWrites';
import {Button} from '@/components/ui/button';import {closingDraftError} from '@/lib/closingReports/closingDraft';
export function ClosingDraftRecoveryPanel(){
 const api=useClosingDraftWrites();const {user}=useAuth();const {currentTenant}=useTenant();const scope=`${currentTenant?.id}:${user?.id}`;
 const [notice,setNotice]=useState({scope,message:''});const message=notice.scope===scope?notice.message:'';
 if(!api.pending&&!api.recoveryError&&!message)return null;
 return <section aria-label="Recuperação de fechamentos" className="mb-4 space-y-2 rounded border p-3">
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
  {api.pending?<div><p>Fechamento “{api.pending.payload.header.title}” sem confirmação.</p><Button disabled={api.isPending} onClick={async()=>{
   setNotice({scope,message:''});try{const result=await api.recover();setNotice({scope,message:'Pedido de criação confirmado: '+result.report.closing_number+'. Nenhum faturamento ou pagamento foi executado.'});}
   catch(error){setNotice({scope,message:closingDraftError(error)});}
  }}>Recuperar fechamento</Button></div>:null}{message?<p role="status">{message}</p>:null}
 </section>;
}
