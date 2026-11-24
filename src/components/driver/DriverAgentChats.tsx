import {useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {useAgentChatContacts} from '@/hooks/useAgentChatDirectory';
import {usePendingAgentChats} from '@/hooks/usePendingAgentChats';
import {Button} from '@/components/ui/button';
import {DriverConversation} from './DriverConversation';
import DriverGeneralChat from './DriverGeneralChat';
import {chatError} from '@/lib/driver/chatCommands';
const roles={owner:'Gestão',admin:'Administração',operator:'Operação',history:'Histórico'};

export function DriverAgentChats({driverId}:{driverId:string}){
 const contacts=useAgentChatContacts(driverId),pending=usePendingAgentChats(),{user}=useAuth();
 const [opened,setOpened]=useState<string[]>([]),[selected,setSelected]=useState<string|null>(null);
 const open=(id:string)=>{setOpened(current=>current.includes(id)?current:[...current,id]);setSelected(id);};
 const name=(id:string)=>contacts.data?.contacts.find(item=>item.user_id===id)?.name??'Atendente indisponível';
 return <div className="grid min-w-0 gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
  <aside aria-label="Atendentes" className="space-y-3 rounded-lg border p-3">
   <h2 className="font-semibold">Com quem deseja conversar?</h2>
   <p className="text-xs text-muted-foreground">Escolha um atendente. Cada pessoa tem sua própria conversa.</p>
   {contacts.isPending?<p role="status">Carregando atendentes…</p>:null}
   {contacts.error?<div role="alert"><p>{chatError(contacts.error)}</p><Button variant="outline" onClick={()=>void contacts.refetch()}>Atualizar atendentes</Button></div>:null}
   {!contacts.isPending&&!contacts.error&&contacts.data?.contacts.length===0?<p>Nenhum atendente disponível nesta empresa.</p>:null}
   {!contacts.error&&contacts.data?.contacts.map(person=><Button key={person.user_id} variant={selected===person.user_id?'secondary':'ghost'} className="h-auto w-full justify-start whitespace-normal text-left" onClick={()=>open(person.user_id)}>
    <span className="min-w-0"><span className="block font-medium">{person.name}</span><span className="block text-xs">{roles[person.role]}{person.active?'':' · indisponível'}</span>
     {person.last_message?<span className="block truncate text-xs opacity-80">{person.last_sender_id===user?.id?'Você: ':''}{person.last_message}</span>:null}
    </span>
   </Button>)}
   {pending.error?<p role="alert">{pending.error}</p>:null}
   {pending.threads.filter(thread=>thread.driverId===driverId).map(thread=><Button key={thread.agentId} variant="outline" className="h-auto whitespace-normal" onClick={()=>open(thread.agentId)}>Envio pendente: {name(thread.agentId)}</Button>)}
   <Button variant="outline" className="h-auto w-full whitespace-normal" onClick={()=>open('general')}>Operação geral / histórico</Button>
  </aside>
  <div className="min-w-0 rounded-lg border">
   {opened.length?<nav aria-label="Conversas abertas" className="flex flex-wrap gap-2 border-b p-2">
    {opened.map(id=><Button key={id} variant={selected===id?'secondary':'ghost'} aria-pressed={selected===id} onClick={()=>setSelected(id)}>{id==='general'?'Operação geral':name(id)}</Button>)}
   </nav>:<p className="p-4">Selecione um atendente para abrir uma conversa direta. Você pode manter várias conversas abertas.</p>}
   {opened.map(id=><div key={id} hidden={selected!==id}>
    {id==='general'?<><p className="p-3 text-sm">Operação geral: estas mensagens ficam visíveis para a equipe autorizada da empresa.</p><DriverGeneralChat heading={false} active={selected===id}/></>
     :<DriverConversation driverId={driverId} agentId={id} active={selected===id}/>}
   </div>)}
  </div>
 </div>;
}
