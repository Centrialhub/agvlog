import {useEffect,useState} from 'react';
import {useItemPreparationWrites} from '@/hooks/useItemPreparationWrites';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {getErrorMessage} from '@/lib/errors';
import {Button} from '@/components/ui/button';
export function ItemPreparationRecoveryPanel(){
 const api=useItemPreparationWrites();const {currentTenant}=useTenant();const {user}=useAuth();
 const [message,setMessage]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);
 useEffect(()=>{setMessage(null);setError(null);},[currentTenant?.id,user?.id]);
 if(!api.pending.length&&!api.recoveryError&&!message&&!error)return null;
 return <section aria-label="Recuperação da preparação de itens" className="mb-4 space-y-2 rounded border p-3">
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
  {api.pending.map(item=><div key={item.requestId} className="space-y-1">
   <p role="status">Há uma preparação de item sem confirmação. Recupere o pedido original antes de repetir a edição ou a importação.</p>
   <p className="text-xs text-muted-foreground">{item.payload.item_id?'Edição':'Inclusão'} · {item.payload.values.item_description||item.payload.item_id||'Item manual'}</p>
   <Button variant="outline" disabled={api.isPending} onClick={async()=>{
    setError(null);setMessage(null);
    try{await api.recover(item.scope);setMessage('Preparação do item confirmada. A carga foi atualizada.');}
    catch(failure){setError(getErrorMessage(failure,'Não foi possível recuperar a preparação.'));}
   }}>Recuperar preparação</Button>
  </div>)}
  {message?<p role="status">{message}</p>:null}{error?<p role="alert">{error}</p>:null}
 </section>;
}
