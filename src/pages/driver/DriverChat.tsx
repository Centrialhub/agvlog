import {useCurrentDriver} from '@/hooks/useCurrentDriver';
import {DriverAgentChats} from '@/components/driver/DriverAgentChats';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {chatError} from '@/lib/driver/chatCommands';
import {Button} from '@/components/ui/button';
export default function DriverChat(){
 const driver=useCurrentDriver();
 const {currentTenant,currentRole}=useTenant(),{user}=useAuth();
 if(driver.isPending)return <p role="status">Carregando motorista...</p>;
 if(driver.error)return <div><p role="alert">{chatError(driver.error)}</p><Button onClick={()=>void driver.refetch()}>Tentar novamente</Button></div>;
 if(!driver.data)return <p>Sua conta não está vinculada a um motorista ativo.</p>;
 return <div className="flex flex-col min-h-0 space-y-3"><h1 className="text-lg font-semibold p-3">Chat com a operação</h1><DriverAgentChats key={`${currentTenant?.id}:${user?.id}:${currentRole}:${driver.data.id}`} driverId={driver.data.id}/></div>;
}
