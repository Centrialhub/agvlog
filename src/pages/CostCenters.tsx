import {useState} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useFinanceAccess} from '@/hooks/useFinanceLedger';
import {Button} from '@/components/ui/button';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {RecordedCosts} from '@/components/financial/RecordedCosts';
import {CostCenterManager} from '@/components/cost-centers/CostCenterManager';
import LegacyCostCenters from './LegacyCostCenters';
export default function CostCenters(){
 const {currentTenant,currentRole}=useTenant(),{user}=useAuth(),access=useFinanceAccess();
 if(!currentTenant||!user)return <p>Entre e selecione a empresa.</p>;
 if(!['owner','admin','operator'].includes(currentRole||''))return <p role="alert">Acesso financeiro não permitido.</p>;
 if(access.isPending)return <p role="status">Verificando acesso…</p>;
 if(access.error)return <p role="alert">Não foi possível verificar o acesso. <Button onClick={()=>void access.refetch()}>Tentar novamente</Button></p>;
 if(!access.data)return <p role="alert">Acesso financeiro não permitido.</p>;
 return <Workspace key={`${currentTenant.id}:${user.id}`} tenant={currentTenant.id} actor={user.id}/>;
}
function Workspace({tenant,actor}:{tenant:string;actor:string}){
 const [tab,setTab]=useState('costs');
 return <div className="space-y-4"><h1 className="text-2xl font-semibold">Centros de custo</h1><Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="costs">Custos registrados</TabsTrigger><TabsTrigger value="management">Gerenciar centros</TabsTrigger><TabsTrigger value="legacy">Comparar fontes antigas</TabsTrigger></TabsList>
 <TabsContent value="costs">{tab==='costs'&&<RecordedCosts tenant={tenant} actor={actor}/>}</TabsContent><TabsContent value="management">{tab==='management'&&<CostCenterManager/>}</TabsContent>
 <TabsContent value="legacy">{tab==='legacy'&&<><p role="alert" className="rounded border border-amber-600 p-3">Esta consulta antiga soma fontes sobrepostas e pode conter duplicidades. Seus totais e exportações não representam o custo consolidado nem o saldo bancário. Use-a para comparar os registros durante a migração.</p><LegacyCostCenters/></>}</TabsContent>
 </Tabs></div>;
}
