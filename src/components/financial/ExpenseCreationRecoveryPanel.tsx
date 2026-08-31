import {useId,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useExpenseCreation} from '@/hooks/useExpenseCreation';
import {Button} from '@/components/ui/button';
export function ExpenseCreationRecoveryPanel(){
 const {currentTenant}=useTenant(),{user}=useAuth();return currentTenant&&user?<Recovery key={currentTenant.id+':'+user.id}/>:null;
}
function Recovery(){
 const command=useExpenseCreation(),id=useId();const [file,setFile]=useState<File>(),[message,setMessage]=useState('');
 if(!command.pending&&!command.recoveryError)return message?<p role="status">{message}</p>:null;
 return <section aria-label="Recuperação de despesa" className="mb-4 space-y-2 rounded border p-3">
  <p role="alert">{command.recoveryError||'Há uma despesa pendente de confirmação nesta sessão. Não registre novamente.'}</p>
  {command.pending?<><p>Pedido {command.pending.payload.request_id} · {command.pending.payload.fields.amount_cents/100} reais</p>
   {command.pending.phase==='upload'?<><label htmlFor={id}>Mesmo comprovante do pedido pendente</label><input id={id} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" onChange={e=>setFile(e.target.files?.[0])}/>
    <p>Se o arquivo já chegou, a recuperação o reconhece sem enviá-lo novamente.</p></>:null}
   <Button disabled={command.isPending} onClick={()=>void command.recover(file).then(()=>{setFile(undefined);setMessage('Despesa recuperada e confirmada pelo banco.');},cause=>setMessage(cause.message))}>Recuperar despesa</Button>
   {command.pending.phase!=='submitting'?<Button variant="outline" disabled={command.isPending} onClick={()=>void command.abandon().then(()=>{setFile(undefined);setMessage('Envio não registrado descartado. Eventual arquivo enviado foi preservado.');},cause=>setMessage(cause.message))}>Descartar envio não registrado</Button>:null}
  </>:null}{message?<p role="status">{message}</p>:null}
 </section>;
}
