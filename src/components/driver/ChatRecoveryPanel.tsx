import {useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useDriverChatSend} from '@/hooks/useDriverChatSend';
import {Button} from '@/components/ui/button';
export function ChatRecoveryPanel(){
 const {currentTenant}=useTenant(),{user}=useAuth();return currentTenant&&user?<Recovery key={currentTenant.id+':'+user.id}/>:null;
}
function Recovery(){
 const send=useDriverChatSend(),[message,setMessage]=useState('');
 if(!send.pending&&!send.recoveryError)return message?<p role="status">{message}</p>:null;
 return <section aria-label="Recuperação de mensagem" className="mb-4 space-y-2 rounded border p-3">
  <p role="alert">{send.recoveryError||'Há uma mensagem sem confirmação. Não envie novamente como outro pedido.'}</p>
  {send.pending?<><p>{send.pending.payload.event_id?'Ocorrência':'Conversa'} {(send.pending.payload.event_id||send.pending.payload.driver_id)?.slice(0,8)} · pedido {send.pending.payload.request_id}</p>
   <Button disabled={send.isPending} onClick={()=>void send.recover().then(()=>setMessage('Mensagem recuperada e confirmada pelo banco.'),cause=>setMessage(cause.message))}>Recuperar mensagem</Button></>:null}
  {message?<p role="status">{message}</p>:null}
 </section>;
}
