import {useCurrentDriver} from '@/hooks/useCurrentDriver';
import {DriverConversation} from '@/components/driver/DriverConversation';
import {chatError} from '@/lib/driver/chatCommands';
import {Button} from '@/components/ui/button';
export default function DriverGeneralChat({heading=true,active=true}:{heading?:boolean;active?:boolean}){
 const driver=useCurrentDriver();
 if(driver.isPending)return <p role="status">Carregando motorista...</p>;
 if(driver.error)return <div><p role="alert">{chatError(driver.error)}</p><Button onClick={()=>void driver.refetch()}>Tentar novamente</Button></div>;
 if(!driver.data)return <p>Sua conta não está vinculada a um motorista ativo.</p>;
 return <div className="flex flex-col min-h-0">{heading?<h1 className="text-lg font-semibold p-3">Chat com a operação</h1>:null}<DriverConversation driverId={driver.data.id} active={active}/></div>;
}
