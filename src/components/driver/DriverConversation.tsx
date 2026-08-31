import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useDriverChatContext,useDriverMessages} from '@/hooks/useDriverMessages';
import {useDriverChatSend} from '@/hooks/useDriverChatSend';
import {chatError,parseChatAck,type ChatCommand,type ChatContext} from '@/lib/driver/chatCommands';
import {CHAT_MESSAGE_CONFIRMED} from '@/lib/driver/chatOutbox';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
type ConversationTarget={driverId:string;eventId?:never}|{driverId?:never;eventId:string};
export function DriverConversation({driverId,eventId}:ConversationTarget){
 const {currentTenant}=useTenant(),{user}=useAuth();return currentTenant&&user?<Conversation key={currentTenant.id+':'+user.id+':'+(eventId?'event:'+eventId:'driver:'+driverId)} driverId={driverId??null} eventId={eventId} actor={user.id}/>:<p>Entre e selecione a empresa.</p>;
}
export function EventConversation({eventId}:{eventId:string}){return <DriverConversation eventId={eventId}/>;}
function Conversation({driverId,eventId,actor}:{driverId:string|null;eventId?:string;actor:string}){
 const query=useDriverMessages(driverId,eventId),context=useDriverChatContext(driverId,eventId),send=useDriverChatSend();
 const [text,setText]=useState(''),[message,setMessage]=useState(''),[preview,setPreview]=useState<ChatContext|null>(null),[invalidated,setInvalidated]=useState(false);
 const alive=useRef(true);
 const recovering=useRef<ChatCommand|null>(null);
 useEffect(()=>{const p=send.pending?.payload;if(p&&p.event_id===eventId&&(eventId||p.driver_id===driverId))recovering.current=p;},[send.pending,driverId,eventId]);
 useEffect(()=>{
  const confirmed=(event:Event)=>{const pending=recovering.current;if(!pending)return;
   try{parseChatAck((event as CustomEvent<unknown>).detail,pending);}catch{return;}
   recovering.current=null;setText(current=>current.trim()===pending.message?'':current);setInvalidated(false);setMessage('Mensagem registrada no servidor. Isso não confirma a leitura.');
  };
  window.addEventListener(CHAT_MESSAGE_CONFIRMED,confirmed);return()=>window.removeEventListener(CHAT_MESSAGE_CONFIRMED,confirmed);
 },[]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!preview&&context.data)setPreview(context.data);},[context.data,preview]);
 const rows=query.error||context.error?[]:query.data?.pages.flatMap(p=>p.messages).slice().reverse()??[];
 const changed=!!preview&&!!context.data&&preview.revision!==context.data.revision;
 const ownPending=!!send.pending&&send.pending.payload.event_id===eventId&&(!!eventId||send.pending.payload.driver_id===driverId);
 const disabled=send.isPending||!!send.pending||!!send.recoveryError||!!context.error||!preview?.can_send||changed||invalidated;
 const submit=async()=>{
  if(disabled||!text.trim()||!preview)return;const draft=text;setMessage('');
  try{await send.submit({driver_id:preview.driver_id,...(eventId?{event_id:eventId}:{}),expected_revision:preview.revision,message:text.trim()});if(alive.current){setText(current=>current===draft?'':current);setMessage('Mensagem registrada no servidor. Isso não confirma a leitura.');}}
  catch(cause){if(alive.current){setMessage(chatError(cause));setInvalidated(true);}}
 };
 return <section aria-label={eventId?'Conversa da ocorrência':'Conversa com motorista e operação'} className="flex flex-1 flex-col min-h-0 space-y-3 p-3">
  {eventId&&preview?<p>{preview.audience==='operation'?'Conversa interna da operação — nenhum motorista recebe estas mensagens.':'Conversa da ocorrência com '+preview.driver_name+'. Mensagens anteriores a outra atribuição não são compartilhadas.'}</p>:null}
  <p className="text-xs text-muted-foreground">Atualização automática a cada 15 segundos e por eventos quando conectada.</p>
  {context.error?<p role="alert">{chatError(context.error)}</p>:null}
  {preview&&!preview.can_send?<p role="alert">O motorista não possui um acesso ativo para receber mensagens.</p>:null}
  {changed||invalidated?<p role="alert">Confira o contexto atualizado antes de enviar.</p>:null}
  <Button variant="outline" disabled={send.isPending} onClick={()=>{void context.refetch().then(r=>{if(alive.current&&r.data&&!r.error){setPreview(r.data);setInvalidated(false);}});void query.refetch();}}>Atualizar conversa</Button>
  {query.isPending?<p role="status">Carregando mensagens...</p>:null}
  {query.error?<p role="alert">{chatError(query.error)}</p>:null}
  {query.hasNextPage?<Button variant="outline" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>Carregar mensagens anteriores</Button>:null}
  <div aria-label="Histórico da conversa" className="flex-1 overflow-y-auto space-y-2">
   {!query.isPending&&!query.error&&!context.error&&rows.length===0?<p>Nenhuma mensagem disponível nesta conversa.</p>:null}
   {rows.map(row=><article key={row.id} className={'rounded border p-3 '+(row.sender_id===actor?'bg-primary/10':'bg-background')}>
    <p className="text-xs text-muted-foreground">{row.verified_sender?(row.sender_id===actor?'Você':row.sender_name||'Participante'):'Registro anterior — identidade não verificada'} · {new Date(row.created_at).toLocaleString('pt-BR')}</p>
    <p className="whitespace-pre-wrap break-words">{row.message}</p>
    {row.has_legacy_attachment?<p className="text-xs">Anexo histórico aguardando validação de acesso pela operação.</p>:null}
   </article>)}
  </div>
  <form className="space-y-2" onSubmit={event=>{event.preventDefault();void submit();}}>
   <label htmlFor={'driver-chat-'+(eventId||driverId)}>Mensagem</label><Textarea id={'driver-chat-'+(eventId||driverId)} value={text} maxLength={4000} onChange={event=>setText(event.target.value)} disabled={send.isPending}/>
   {send.pending?<p role="alert">{ownPending?'Há uma mensagem desta conversa sem confirmação.':'Há um envio de outra conversa. Feche esta janela para usar o painel de recuperação.'}</p>:null}
   {ownPending?<Button type="button" disabled={send.isPending} onClick={()=>void send.recover().catch(cause=>{if(alive.current)setMessage(chatError(cause));})}>Recuperar envio desta conversa</Button>:null}
   {send.recoveryError?<p role="alert">{send.recoveryError}</p>:null}
   {message?<p role="status">{message}</p>:null}
   <Button type="submit" disabled={disabled||!text.trim()}>Enviar mensagem</Button>
  </form>
 </section>;
}
