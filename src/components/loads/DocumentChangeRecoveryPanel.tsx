import {useEffect,useState} from 'react';
import {useLoadDocumentChanges} from '@/hooks/useLoadDocumentChanges';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {getErrorMessage} from '@/lib/errors';
import {Button} from '@/components/ui/button';
export function DocumentChangeRecoveryPanel(){
 const api=useLoadDocumentChanges();const {currentTenant}=useTenant();const {user}=useAuth();
 const [message,setMessage]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);
 useEffect(()=>{setMessage(null);setError(null);},[currentTenant?.id,user?.id]);
 if(!api.pending.length&&!api.recoveryError&&!message&&!error)return null;
 return <section aria-label="Recuperação de alterações de documentos" className="mb-4 space-y-2 rounded border p-3">
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
  {api.pending.map(item=><div key={item.requestId} className="space-y-1">
   <p role="status">Há uma alteração de documentos sem confirmação. Recupere a solicitação original antes de repetir a edição.</p>
   <p className="text-xs text-muted-foreground">{item.payload.document_ids.length} nota(s) · {item.payload.action==='attach'?'Inclusão':'Remoção'} · {item.payload.reason}</p>
   <Button variant="outline" disabled={api.isPending} onClick={async()=>{
    setError(null);setMessage(null);
    try{const result=await api.recover(item.scope);setMessage(`${result.document_count} nota(s): alteração confirmada${result.load_removed?'; carga vazia removida':''}.`);}
    catch(failure){setError(getErrorMessage(failure,'Não foi possível recuperar a alteração.'));}
   }}>Recuperar alteração</Button>
  </div>)}
  {message?<p role="status">{message}</p>:null}{error?<p role="alert">{error}</p>:null}
 </section>;
}
