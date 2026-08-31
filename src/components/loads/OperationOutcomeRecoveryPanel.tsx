import {useEffect,useState} from 'react';
import {useOperationDocumentOutcomes} from '@/hooks/useOperationDocumentOutcomes';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {getErrorMessage} from '@/lib/errors';
import {Button} from '@/components/ui/button';
import {operationResultMessage} from '@/lib/loads/operationDocumentOutcome';
export function OperationOutcomeRecoveryPanel(){
 const api=useOperationDocumentOutcomes();const {currentTenant}=useTenant();const {user}=useAuth();
 const [message,setMessage]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);
 useEffect(()=>{setMessage(null);setError(null);},[currentTenant?.id,user?.id]);
 if(!api.pending.length&&!api.recoveryError&&!message&&!error)return null;
 return <section aria-label="Recuperação de resultados operacionais" className="mb-4 space-y-2 rounded border p-3">
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
  {api.pending.map(item=><div key={item.requestId} className="space-y-1">
   <p role="status">Há um resultado operacional sem confirmação. Recupere o pedido original antes de registrar outra baixa.</p>
   <p className="text-xs text-muted-foreground">Nota: {item.payload.document_id}</p>
   <Button variant="outline" disabled={api.isPending} onClick={async()=>{
    setError(null);setMessage(null);
    try{const result=await api.recover(item.scope);setMessage(result.correction_of?operationResultMessage(result):'Resultado operacional confirmado. Confira a nota e a situação do comprovante.');}
    catch(failure){setError(getErrorMessage(failure,'Não foi possível recuperar o resultado.'));}
   }}>Recuperar resultado</Button>
  </div>)}
  {message?<p role="status">{message}</p>:null}{error?<p role="alert">{error}</p>:null}
 </section>;
}
