import {useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {Button} from '@/components/ui/button';
import {AgentOperationalChat} from '@/components/driver/AgentOperationalChat';
import LegacyChat from './OperationalDriverChatLegacy';
export default function OperationalDriverChat(){
 const {user}=useAuth(),{currentTenant,currentRole,loading}=useTenant();
 if(loading)return <p role="status">Carregando acesso ao chat...</p>;
 if(!user||!currentTenant||!['owner','admin','operator'].includes(currentRole??''))return <p role="alert">Sem acesso ao chat operacional neste tenant.</p>;
 return <ChatModes key={`${currentTenant.id}:${user.id}:${currentRole}`} actorId={user.id}/>;
}
function ChatModes({actorId}:{actorId:string}){
 const [general,setGeneral]=useState(false);
 return <div className="space-y-4"><nav aria-label="Tipo de conversa" className="flex flex-wrap gap-2">
  <Button variant={general?'outline':'default'} aria-pressed={!general} onClick={()=>setGeneral(false)}>Minhas conversas diretas</Button>
  <Button variant={general?'default':'outline'} aria-pressed={general} onClick={()=>setGeneral(true)}>Operação geral / histórico</Button>
 </nav><div hidden={general}><AgentOperationalChat actorId={actorId} active={!general}/></div>{general?<LegacyChat/>:null}</div>;
}
