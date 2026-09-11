import {useState} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {FinanceAccessBoundary} from '@/components/financial/FinanceAccessBoundary';
import {CashForecastPanel} from '@/components/financial/CashForecastPanel';
import {CashForecastComparisonPanel} from '@/components/financial/CashForecastComparisonPanel';

export default function FinanceCashForecast(){
 const {currentTenant}=useTenant();const {user}=useAuth();
 return <FinanceAccessBoundary>{currentTenant&&user&&<ForecastWorkspace key={`${currentTenant.id}:${user.id}`} tenant={currentTenant.id} actor={user.id}/>}</FinanceAccessBoundary>;
}
function ForecastWorkspace({tenant,actor}:{tenant:string;actor:string}){
 const [snapshotId,setSnapshotId]=useState<string|null>(null);
 return <main className="space-y-6"><header><h1 className="text-2xl font-semibold">Previsão de caixa</h1><p className="text-sm text-muted-foreground">Confira as entradas e saídas esperadas. Preserve uma previsão para comparar depois com o dinheiro realizado no período.</p></header><CashForecastPanel tenant={tenant} actor={actor} onSelectSnapshot={setSnapshotId}/>{snapshotId&&<CashForecastComparisonPanel key={snapshotId} tenant={tenant} actor={actor} snapshotId={snapshotId}/>}</main>;
}
