import { useState } from 'react';
import { HandCoins, Plus, Wallet } from 'lucide-react';
import {
  PAYROLL_PAYMENT_STATUS_LABELS,
  PAYROLL_PERIOD_STATUS_LABELS,
  type PayrollEntry,
  usePayrollPeriods,
} from '@/hooks/usePayroll';
import { useListFilters } from '@/hooks/useListFilters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PayrollStatusBadge } from '@/components/financial/PayrollStatusBadge';
import { AdvancesTable, RegisterAdvanceDialog } from '@/components/financial/payroll/PayrollAdvances';
import { EntryDrawer } from '@/components/financial/payroll/PayrollEntryDrawer';
import { GeneratePeriodDialog } from '@/components/financial/payroll/PayrollGeneratePeriodDialog';
import { fmtDateSafe } from '@/lib/utils/formatDate';
import { PeriodEntries } from '@/components/financial/payroll/PayrollPeriodEntries';
import { useTenant } from '@/hooks/useTenant';

export { PeriodEntries };

export default function Payroll() {
  const {currentTenant}=useTenant();
  const [periodPage,setPeriodPage]=useState(1);
  const [periodPaging,setPeriodPaging]=useState({snapshotAt:'',collectionRevision:''});
  const [tab, setTab] = useState('periods');
  const { filters, setFilter, resetFilters, activeCount } = useListFilters({ search: '', status: 'all', payment: 'all' }, 'period_');
  const resetPeriodPaging=()=>{setPeriodPage(1);setPeriodPaging({snapshotAt:'',collectionRevision:''});};
  const { data: periodResult, isLoading, error: periodError, refetch: refetchPeriods } = usePayrollPeriods(periodPage,filters,periodPaging);const periods=periodResult?.rows??[];
  const refreshPeriods=()=>{if(periodPage===1&&!periodPaging.snapshotAt&&!periodPaging.collectionRevision)void refetchPeriods();else resetPeriodPaging();};
  const filteredPeriods = periods;
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [entryDrawer, setEntryDrawer] = useState<PayrollEntry | null>(null);

  const activePeriod = periods.find(period => period.id === selectedPeriodId) ?? periods[0] ?? null;
  const currentPeriodId = activePeriod?.id;

  return (
    <div className="space-y-4">
      <div className="finance-page-header">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Wallet className="h-5 w-5" /> Folha de Pagamento</h1>
          <p className="text-sm text-muted-foreground">Pré-folha integrada com acertos, despesas, adiantamentos e ocorrências</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdvanceOpen(true)}><HandCoins className="h-4 w-4 mr-1" /> Adiantamento</Button>
          <Button size="sm" onClick={() => setGenOpen(true)}><Plus className="h-4 w-4 mr-1" /> Gerar Folha</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="periods">Períodos</TabsTrigger>
          <TabsTrigger value="entries" disabled={!currentPeriodId}>Entradas</TabsTrigger>
          <TabsTrigger value="advances">Adiantamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="periods" className="space-y-3">
          {periodError ? <div role="alert" className="space-y-2 text-destructive"><p>{periodError instanceof Error&&periodError.message.includes('payroll_period_collection_changed')?'A lista mudou durante a navegação. Atualize para consultar os períodos atuais.':'Não foi possível conferir os períodos da folha.'}</p><Button variant="outline" onClick={refreshPeriods}>Atualizar períodos</Button></div> : <>
          <ListFilterBar fields={[
            { key: 'search', label: 'Buscar período da folha', type: 'search', value: filters.search, onChange: value => {resetPeriodPaging();setFilter('search', value);}, placeholder: 'Nome ou competência do período' },
            { key: 'status', label: 'Situação da folha', value: filters.status, onChange: value => {resetPeriodPaging();setFilter('status', value);}, options: [{ value: 'all', label: 'Todas as situações' }, ...Object.entries(PAYROLL_PERIOD_STATUS_LABELS).map(([value, label]) => ({ value, label }))] },
            { key: 'payment', label: 'Pagamento', value: filters.payment, onChange: value => {resetPeriodPaging();setFilter('payment', value);}, options: [{ value: 'all', label: 'Todos' }, ...Object.entries(PAYROLL_PAYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))] },
          ]} onReset={()=>{resetPeriodPaging();resetFilters();}} activeCount={activeCount} resultCount={filteredPeriods.length} totalCount={periodResult?.total??0} loading={isLoading} />
          <Card><CardContent className="p-0">
            <Table scrollLabel="Resultados financeiros — role para ver todas as colunas">
              <TableHeader><TableRow><TableHead>Período</TableHead><TableHead>Início</TableHead><TableHead>Fim</TableHead><TableHead>Status</TableHead><TableHead>Pagamento</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
              <TableBody>
                {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Carregando...</TableCell></TableRow>
                  : filteredPeriods.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Nenhum período encontrado para os filtros.</TableCell></TableRow>
                    : filteredPeriods.map(period => (
                      <TableRow key={period.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setSelectedPeriodId(period.id); setTab('entries'); }}>
                        <TableCell className="font-medium text-sm">{period.period_name}</TableCell>
                        <TableCell className="text-sm">{fmtDateSafe(period.period_start)}</TableCell>
                        <TableCell className="text-sm">{fmtDateSafe(period.period_end)}</TableCell>
                        <TableCell><PayrollStatusBadge status={period.status} /></TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{PAYROLL_PAYMENT_STATUS_LABELS[period.payment_status] ?? period.payment_status}</Badge></TableCell>
                        <TableCell><Button variant="ghost" size="sm" onClick={event => { event.stopPropagation(); setSelectedPeriodId(period.id); setTab('entries'); }}>Abrir</Button></TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </CardContent></Card>
          <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" disabled={periodPage===1||isLoading} onClick={()=>periodPage===2?resetPeriodPaging():setPeriodPage(p=>p-1)}>Anterior</Button><div className="flex items-center gap-2"><span className="text-sm">Página {periodPage} de {Math.max(1,Math.ceil((periodResult?.total??0)/30))}</span><Button variant="ghost" disabled={isLoading} onClick={refreshPeriods}>Atualizar</Button></div><Button variant="outline" disabled={periodPage*30>=(periodResult?.total??0)||isLoading} onClick={()=>{if(periodResult)setPeriodPaging({snapshotAt:periodResult.snapshot_at,collectionRevision:periodResult.collection_revision});setPeriodPage(p=>p+1);}}>Próxima</Button></div>
          </>}
        </TabsContent>

        <TabsContent value="entries">{activePeriod && <PeriodEntries period={activePeriod} onOpenEntry={setEntryDrawer} />}</TabsContent>
        <TabsContent value="advances"><AdvancesTable /></TabsContent>
      </Tabs>

      <GeneratePeriodDialog open={genOpen} onOpenChange={setGenOpen} onGenerated={periodId=>{setSelectedPeriodId(periodId);resetPeriodPaging();}} />
      <RegisterAdvanceDialog key={currentTenant?.id ?? 'none'} open={advanceOpen} onOpenChange={setAdvanceOpen} />
      <EntryDrawer entry={entryDrawer} period={activePeriod} onClose={() => setEntryDrawer(null)} />
    </div>
  );
}
