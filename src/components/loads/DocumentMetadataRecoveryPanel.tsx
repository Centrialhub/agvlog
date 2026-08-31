import {useState} from 'react';
import {useAuth} from '@/hooks/useAuth';import {useTenant} from '@/hooks/useTenant';
import {useDocumentMetadataWrites} from '@/hooks/useDocumentMetadataWrites';
import {Button} from '@/components/ui/button';import {getErrorMessage} from '@/lib/errors';
export function DocumentMetadataRecoveryPanel(){
 const api=useDocumentMetadataWrites();const {user}=useAuth();const {currentTenant}=useTenant();const scope=`${currentTenant?.id}:${user?.id}`;
 const [notice,setNotice]=useState({scope,message:''});const message=notice.scope===scope?notice.message:'';
 if(!api.pending.length&&!api.recoveryError&&!message)return null;
 return <section aria-label="Recuperação de conferências" className="mb-4 space-y-2 rounded border p-3">
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
  {api.pending.map(row=><div key={row.requestId}><p>Conferência de {row.payload.items.length} nota(s) da carga {row.payload.load_id.slice(0,8)} sem confirmação.</p>
   <Button disabled={api.isPending} onClick={async()=>{setNotice({scope,message:''});try{await api.recover(row.payload.load_id);setNotice({scope,message:'Conferência confirmada; resultados de entrega e valores financeiros preservados.'});}
    catch(error){setNotice({scope,message:getErrorMessage(error,'Recuperação não confirmada.')});}}}>Recuperar conferência</Button></div>)}
  {message?<p role="status">{message}</p>:null}
 </section>;
}
