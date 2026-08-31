import {useState} from 'react';
import {useRedelivery} from '@/hooks/useRedelivery';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {Button} from '@/components/ui/button';
import {getErrorMessage} from '@/lib/errors';
export function RedeliveryRecoveryPanel(){
 const api=useRedelivery();const {user}=useAuth();const {currentTenant}=useTenant();
 const scope=`${currentTenant?.id}:${user?.id}`;const [notice,setNotice]=useState({scope,message:''});
 const message=notice.scope===scope?notice.message:'';const setMessage=(value:string)=>setNotice({scope,message:value});
 if(!api.pending.length&&!api.recoveryError&&!message)return null;
 return <section aria-label="Recuperação de reentrega" className="mb-4 space-y-2 rounded border p-3">
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
  {api.pending.map(row=><div key={row.requestId}><p>Reentrega da nota {row.payload.document_id.slice(0,8)} sem confirmação. O pedido pode ter sido concluído.</p>
   <Button disabled={api.isPending} onClick={async()=>{setMessage('');try{await api.recover(row.payload.document_id);setMessage('Reentrega confirmada; histórico preservado e saldo disponível para nova carga.');}
    catch(error){setMessage(getErrorMessage(error,'Recuperação não confirmada.'));}}}>Recuperar reentrega</Button></div>)}
  {message?<p role="status">{message}</p>:null}
 </section>;
}
