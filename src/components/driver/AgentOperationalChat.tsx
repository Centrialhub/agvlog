import {useState} from 'react';
import {useAgentChatInbox} from '@/hooks/useAgentChatDirectory';
import {usePendingAgentChats} from '@/hooks/usePendingAgentChats';
import {useDrivers} from '@/hooks/useDrivers';
import {Button} from '@/components/ui/button';
import {DriverConversation} from './DriverConversation';
import {chatError} from '@/lib/driver/chatCommands';

export function AgentOperationalChat({actorId,active=true}:{actorId:string;active?:boolean}){
 const inbox=useAgentChatInbox(),drivers=useDrivers({includeInactive:true}),pending=usePendingAgentChats();
 const [opened,setOpened]=useState<Array<{id:string;name:string}>>([]),[selected,setSelected]=useState('');
 const open=(id:string,name:string)=>{setOpened(current=>current.some(item=>item.id===id)?current:[...current,{id,name}]);setSelected(id);};
 const rows=inbox.error?[]:inbox.data?.pages.flatMap(page=>page.threads)??[];
 const byDriver=new Map<string,(typeof rows)[number]>();for(const row of rows)if(!byDriver.has(row.driver_id))byDriver.set(row.driver_id,row);
 const threads=[...byDriver.values()];
 return <section className="space-y-4">
  <div><h1 className="text-2xl font-semibold">Chat com motoristas</h1><p className="text-sm text-muted-foreground">Sua caixa de conversas diretas. As respostas chegam ao motorista na conversa com seu nome.</p></div>
  <div className="grid min-w-0 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
   <aside aria-label="Conversas recentes" className="space-y-3 rounded-lg border p-3">
    <label htmlFor="agent-chat-driver" className="text-sm font-medium">Iniciar conversa com motorista</label>
    <select id="agent-chat-driver" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value="" disabled={drivers.isPending||!!drivers.error}
     onChange={event=>{const driver=drivers.data?.find(item=>item.id===event.target.value);if(driver)open(driver.id,driver.name);}}>
     <option value="">Selecione um motorista</option>{!drivers.error&&drivers.data?.map(driver=><option key={driver.id} value={driver.id}>{driver.name}{driver.active?'':' (inativo)'}</option>)}
    </select>
    {drivers.error?<div role="alert"><p>Não foi possível carregar os motoristas.</p><Button variant="outline" onClick={()=>void drivers.refetch()}>Atualizar motoristas</Button></div>:null}
    {inbox.isPending?<p role="status">Carregando conversas…</p>:null}
    {inbox.error?<div role="alert"><p>{chatError(inbox.error)}</p><Button variant="outline" onClick={()=>void inbox.refetch()}>Atualizar conversas</Button></div>:null}
    {!inbox.isPending&&!inbox.error&&threads.length===0?<p>Nenhuma conversa direta recebida. Selecione um motorista para começar.</p>:null}
    {threads.map(thread=><Button key={thread.driver_id} variant={selected===thread.driver_id?'secondary':'ghost'} className="h-auto w-full justify-start whitespace-normal text-left" onClick={()=>open(thread.driver_id,thread.driver_name)}>
     <span className="min-w-0"><span className="block font-medium">{thread.driver_name}</span><span className="block truncate text-xs opacity-80">{thread.sender_id===actorId?'Você: ':'Motorista: '}{thread.message}</span><span className="block text-xs opacity-80">{new Date(thread.created_at).toLocaleString('pt-BR')}</span></span>
    </Button>)}
    {inbox.hasNextPage?<Button variant="outline" disabled={inbox.isFetchingNextPage} onClick={()=>void inbox.fetchNextPage()}>Mais conversas</Button>:null}
    {pending.error?<p role="alert">{pending.error}</p>:null}
    {pending.threads.filter(thread=>thread.agentId===actorId).map(thread=><Button key={thread.driverId} variant="outline" className="h-auto whitespace-normal" onClick={()=>open(thread.driverId,drivers.data?.find(item=>item.id===thread.driverId)?.name??'Motorista indisponível')}>Envio pendente: {drivers.data?.find(item=>item.id===thread.driverId)?.name??'motorista'}</Button>)}
   </aside>
   <div className="min-w-0 rounded-lg border">
    {opened.length?<nav aria-label="Conversas abertas" className="flex flex-wrap gap-2 border-b p-2">{opened.map(driver=><Button key={driver.id} aria-pressed={selected===driver.id} variant={selected===driver.id?'secondary':'ghost'} onClick={()=>setSelected(driver.id)}>{driver.name}</Button>)}</nav>
     :<p className="p-4">Selecione uma conversa. Você pode atender vários motoristas em abas separadas.</p>}
    {opened.map(driver=><div key={driver.id} hidden={selected!==driver.id}><h2 className="border-b p-3 font-medium">{driver.name}</h2><DriverConversation driverId={driver.id} agentId={actorId} active={active&&selected===driver.id}/></div>)}
   </div>
  </div>
 </section>;
}
