import {PeriodMoneyPackagePanel} from '@/components/financial/PeriodMoneyPackagePanel';
import {PayablePortfolioPanel} from '@/components/financial/PayablePortfolioPanel';
import {recordedCostCategoryLabels} from '@/lib/financial/recordedCostCategories';
import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useClients} from '@/hooks/useClients';
import {useCostCenters} from '@/hooks/useCostCenters';
import {useReceivablePortfolio} from '@/hooks/useReceivablePortfolio';
import {useRecordedCostSummary} from '@/hooks/useRecordedCostSummary';
import {useFiscalDashboardSummary} from '@/hooks/useFiscalDashboardSummary';
import {portfolioFilters} from '@/lib/financial/receivablePortfolioContract';
import {ReceivablePortfolioCard,ReceivablePortfolioStatus} from '@/components/financial/ReceivablePortfolio';
import {RecordedCostCard,RecordedCostSummary} from '@/components/financial/RecordedCostSummary';
import {FiscalDashboardCard,FiscalDashboardSummary} from '@/components/financial/FiscalDashboardSummary';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {UnbilledFreightPanel} from '@/components/financial/UnbilledFreightPanel';
type Filters={period:'7d'|'30d'|'90d'|'all';from:string;to:string;client:string;docType:'all'|'cte'|'nfse';category:string;costCenter:string};
const initial:Filters={period:'30d',from:'',to:'',client:'all',docType:'all',category:'',costCenter:'all'};
export default function Financial(){
 const {currentTenant}=useTenant(),{user}=useAuth(),navigate=useNavigate();
 const {data:clients=[]}=useClients(),{fullData:centers=[]}=useCostCenters();
 const [draft,setDraft]=useState<Filters>(initial),[filters,setFilters]=useState<Filters>(initial);
 const bounds=portfolioFilters(filters.period,filters.from,filters.to,filters.client);
 const portfolio=useReceivablePortfolio(currentTenant?.id,user?.id,bounds);
 const costs=useRecordedCostSummary(currentTenant?.id,user?.id,{from:bounds.from,to:bounds.to,category:filters.category||null,costCenter:filters.costCenter==='all'?null:filters.costCenter});
 const fiscal=useFiscalDashboardSummary(currentTenant?.id,user?.id,{...bounds,docType:filters.docType});
 const busy=portfolio.query.isFetching||costs.query.isFetching||fiscal.query.isFetching;
 function apply(){setFilters({...draft,category:draft.category.trim()});if(JSON.stringify(draft)===JSON.stringify(filters)){void portfolio.query.refetch();void costs.query.refetch();void fiscal.query.refetch();}}
 return <div className="space-y-5"><header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">Financeiro</h1><p className="text-sm text-muted-foreground">Carteira, custos registrados e títulos fiscais incorporados. Estes resumos não representam caixa conciliado ou fechamento.</p></div><nav className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>navigate('/receivables')}>Contas a receber</Button><Button variant="outline" onClick={()=>navigate('/payables')}>Contas a pagar</Button><Button variant="outline" onClick={()=>navigate('/payroll')}>Folha de pagamento</Button><Button variant="outline" onClick={()=>navigate('/financial/statements')}>Importar e conferir extratos</Button><Button variant="outline" onClick={()=>navigate('/financial/recorded-expenses')}>Despesas registradas</Button><Button variant="outline" onClick={()=>navigate('/expense-approval')}>Conferência de despesas antigas</Button><Button variant="outline" onClick={()=>navigate('/driver-settlements')}>Acerto de motoristas</Button><Button variant="outline" onClick={()=>navigate('/financial/movements')}>Movimentações</Button></nav></header>
 <form className="rounded border p-3 space-y-3" onSubmit={event=>{event.preventDefault();apply();}}><div className="grid sm:grid-cols-3 gap-3"><label>Período<select className="block border rounded p-2 w-full" value={draft.period} onChange={event=>setDraft({...draft,period:event.target.value as Filters['period']})}><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="90d">Últimos 90 dias</option><option value="all">Todo o período</option></select></label><label>Data inicial<Input type="date" value={draft.from} onChange={event=>setDraft({...draft,from:event.target.value})}/></label><label>Data final<Input type="date" min={draft.from||undefined} value={draft.to} onChange={event=>setDraft({...draft,to:event.target.value})}/></label><label>Cliente — carteira e fiscal<select className="block border rounded p-2 w-full" value={draft.client} onChange={event=>setDraft({...draft,client:event.target.value})}><option value="all">Todos</option>{clients.map(client=><option key={client.id} value={client.id}>{client.company_name}{client.active===false?' · Inativo':''}</option>)}</select></label><label>Tipo fiscal<select className="block border rounded p-2 w-full" value={draft.docType} onChange={event=>setDraft({...draft,docType:event.target.value as Filters['docType']})}><option value="all">CT-e e NFS-e</option><option value="cte">CT-e</option><option value="nfse">NFS-e</option></select></label><label>Categoria dos custos registrados<select className="block border rounded p-2 w-full" value={draft.category} onChange={event=>setDraft({...draft,category:event.target.value})}><option value="">Todas</option>{Object.entries(recordedCostCategoryLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>Centro de custo dos registros incorporados<select className="block border rounded p-2 w-full" value={draft.costCenter} onChange={event=>setDraft({...draft,costCenter:event.target.value})}><option value="all">Todos</option><option value="unassigned">Sem centro de custo</option>{centers.map(center=><option key={center.id} value={center.id}>{center.name}{center.active?'':' · Inativo'}</option>)}</select></label></div><p className="text-xs text-muted-foreground">Datas explícitas substituem os limites do período rápido. Carteira usa criação do título; fiscal usa incorporação; custos usam a data registrada em sua fonte.</p><div className="flex gap-2"><Button type="submit" disabled={busy}>Aplicar filtros</Button><Button type="button" variant="outline" onClick={()=>{setDraft(initial);setFilters(initial);}}>Limpar filtros</Button></div></form>
 <div className="grid md:grid-cols-3 gap-3"><ReceivablePortfolioCard state={portfolio}/><RecordedCostCard state={costs}/><FiscalDashboardCard state={fiscal}/></div>
 <ReceivablePortfolioStatus state={portfolio} onManage={()=>navigate('/receivables')}/>
 {currentTenant&&user&&<PayablePortfolioPanel tenant={currentTenant.id} actor={user.id} onManage={()=>navigate('/payables')}/>}
 <RecordedCostSummary state={costs} onManage={()=>navigate('/financial/recorded-expenses')}/>
 <FiscalDashboardSummary state={fiscal}/>
 {currentTenant&&user&&<PeriodMoneyPackagePanel tenant={currentTenant.id} actor={user.id}/>}
 {currentTenant&&user&&<UnbilledFreightPanel tenant={currentTenant.id} actor={user.id} clients={clients.map(client=>({id:client.id,label:client.company_name}))}/>}
 </div>;
}
