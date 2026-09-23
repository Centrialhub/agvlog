import { FinanceSection } from '@/components/financial/FinanceSection';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CostDispositionsPanel } from '@/components/financial/CostDispositionsPanel';
import { PeriodMoneyPackagePanel } from '@/components/financial/PeriodMoneyPackagePanel';
import { PayablePortfolioPanel } from '@/components/financial/PayablePortfolioPanel';
import { ReceivablePortfolioCard, ReceivablePortfolioStatus } from '@/components/financial/ReceivablePortfolio';
import { RecordedCostCard, RecordedCostSummary } from '@/components/financial/RecordedCostSummary';
import { FiscalDashboardCard, FiscalDashboardSummary } from '@/components/financial/FiscalDashboardSummary';
import { UnbilledFreightPanel } from '@/components/financial/UnbilledFreightPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useClients } from '@/hooks/useClients';
import { useCostCenters } from '@/hooks/useCostCenters';
import { useReceivablePortfolio } from '@/hooks/useReceivablePortfolio';
import { useRecordedCostSummary } from '@/hooks/useRecordedCostSummary';
import { useFiscalDashboardSummary } from '@/hooks/useFiscalDashboardSummary';
import { portfolioFilters } from '@/lib/financial/receivablePortfolioContract';
import { recordedCostCategoryLabels } from '@/lib/financial/recordedCostCategories';

type Filters = {
  period: '7d' | '30d' | '90d' | 'all';
  from: string;
  to: string;
  client: string;
  docType: 'all' | 'cte' | 'nfse';
  category: string;
  costCenter: string;
};

const initial: Filters = {
  period: '30d',
  from: '',
  to: '',
  client: 'all',
  docType: 'all',
  category: '',
  costCenter: 'all',
};

const navigationButtonClass = 'h-auto min-h-12 min-w-0 justify-start whitespace-normal px-4 py-3 text-left';

export default function Financial() {
  const { currentTenant } = useTenant();
  return <FinancialWorkspace key={currentTenant?.id ?? 'none'} />;
}

function FinancialWorkspace() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: clients = [] } = useClients();
  const { fullData: centers = [] } = useCostCenters();
  const [draft, setDraft] = useState<Filters>(initial);
  const [filters, setFilters] = useState<Filters>(initial);

  const bounds = portfolioFilters(filters.period, filters.from, filters.to, filters.client);
  const portfolio = useReceivablePortfolio(currentTenant?.id, user?.id, bounds);
  const costs = useRecordedCostSummary(currentTenant?.id, user?.id, {
    from: bounds.from,
    to: bounds.to,
    category: filters.category || null,
    costCenter: filters.costCenter === 'all' ? null : filters.costCenter,
  });
  const fiscal = useFiscalDashboardSummary(currentTenant?.id, user?.id, {
    ...bounds,
    docType: filters.docType,
  });
  const busy = portfolio.query.isFetching || costs.query.isFetching || fiscal.query.isFetching;

  function apply() {
    setFilters({ ...draft, category: draft.category.trim() });
    if (JSON.stringify(draft) === JSON.stringify(filters)) {
      void portfolio.query.refetch();
      void costs.query.refetch();
      void fiscal.query.refetch();
    }
  }

  const clientOptions = [
    { value: 'all', label: 'Todos' },
    ...clients.map(client => ({
      value: client.id,
      label: client.company_name,
      hint: client.active === false ? 'Inativo' : undefined,
    })),
  ];

  return (
    <div className="min-w-0 space-y-5">
      <header className="flex min-w-0 flex-col gap-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Financeiro</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe valores a receber, obrigações e custos. Os resumos não representam caixa conciliado ou fechamento.
          </p>
        </div>
        <nav aria-label="Navegação financeira" className="grid w-full grid-cols-2 gap-2 xl:grid-cols-4">
          <Button className={navigationButtonClass} variant="outline" onClick={() => navigate('/receivables')}>Contas a receber</Button>
          <Button className={navigationButtonClass} variant="outline" onClick={() => navigate('/payables')}>Contas a pagar</Button>
          <Button className={navigationButtonClass} variant="outline" onClick={() => navigate('/payroll')}>Folha de pagamento</Button>
          <Button className={navigationButtonClass} variant="outline" onClick={() => navigate('/financial/statements')}>Importar e conferir extratos</Button>
          <Button className={navigationButtonClass} variant="outline" onClick={() => navigate('/financial/recorded-expenses')}>Despesas registradas</Button>
          <Button className={navigationButtonClass} variant="outline" onClick={() => navigate('/expense-approval')}>Conferência de despesas antigas</Button>
          <Button className={navigationButtonClass} variant="outline" onClick={() => navigate('/driver-settlements')}>Acerto de motoristas</Button>
          <Button className={navigationButtonClass} variant="outline" onClick={() => navigate('/financial/movements')}>Movimentações</Button>
        </nav>
      </header>

      <form
        aria-label="Filtros do resumo financeiro"
        className="min-w-0 space-y-4 rounded-xl border bg-muted/20 p-4 sm:p-5"
        onSubmit={event => {
          event.preventDefault();
          apply();
        }}
      >
        <h2 className="font-semibold">Filtrar resumo</h2>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="min-w-0 space-y-1 text-sm font-medium">
            Período
            <select
              className="block min-h-10 w-full min-w-0 rounded-md border bg-background p-2"
              value={draft.period}
              onChange={event => setDraft({ ...draft, period: event.target.value as Filters['period'] })}
            >
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="90d">Últimos 90 dias</option>
              <option value="all">Todo o período</option>
            </select>
          </label>
          <label className="min-w-0 space-y-1 text-sm font-medium">
            Data inicial
            <Input className="min-h-10 min-w-0" type="date" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} />
          </label>
          <label className="min-w-0 space-y-1 text-sm font-medium">
            Data final
            <Input className="min-h-10 min-w-0" type="date" min={draft.from || undefined} value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} />
          </label>
          <div className="min-w-0 space-y-1 text-sm font-medium">
            <span className="text-sm font-medium">Cliente — carteira e fiscal</span>
            <SearchableSelect
              ariaLabel="Cliente — carteira e fiscal"
              options={clientOptions}
              value={draft.client}
              onChange={client => setDraft({ ...draft, client })}
              placeholder="Selecionar cliente"
              searchPlaceholder="Buscar cliente..."
              className="min-h-10 min-w-0 text-sm"
            />
          </div>
          <label className="min-w-0 space-y-1 text-sm font-medium">
            Tipo fiscal
            <select
              className="block min-h-10 w-full min-w-0 rounded-md border bg-background p-2"
              value={draft.docType}
              onChange={event => setDraft({ ...draft, docType: event.target.value as Filters['docType'] })}
            >
              <option value="all">CT-e e NFS-e</option>
              <option value="cte">CT-e</option>
              <option value="nfse">NFS-e</option>
            </select>
          </label>
          <label className="min-w-0 space-y-1 text-sm font-medium">
            Categoria dos custos registrados
            <select
              className="block min-h-10 w-full min-w-0 rounded-md border bg-background p-2"
              value={draft.category}
              onChange={event => setDraft({ ...draft, category: event.target.value })}
            >
              <option value="">Todas</option>
              {Object.entries(recordedCostCategoryLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="min-w-0 space-y-1 text-sm font-medium">
            Centro de custo dos registros incorporados
            <select
              className="block min-h-10 w-full min-w-0 rounded-md border bg-background p-2"
              value={draft.costCenter}
              onChange={event => setDraft({ ...draft, costCenter: event.target.value })}
            >
              <option value="all">Todos</option>
              <option value="unassigned">Sem centro de custo</option>
              {centers.map(center => <option key={center.id} value={center.id}>{center.name}{center.active ? '' : ' · Inativo'}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Datas explícitas substituem os limites do período rápido. Carteira usa criação do título; fiscal usa incorporação; custos usam a data registrada em sua fonte.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="min-h-11" type="submit" disabled={busy}>Aplicar filtros</Button>
          <Button className="min-h-11" type="button" variant="outline" onClick={() => { setDraft(initial); setFilters(initial); }}>Limpar filtros</Button>
        </div>
      </form>

      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        <ReceivablePortfolioCard state={portfolio} />
        <RecordedCostCard state={costs} />
        <FiscalDashboardCard state={fiscal} />
      </div>
      <ReceivablePortfolioStatus state={portfolio} onManage={() => navigate('/receivables')} />
      {currentTenant && user && <PayablePortfolioPanel tenant={currentTenant.id} actor={user.id} onManage={() => navigate('/payables')} />}
      <RecordedCostSummary state={costs} onManage={() => navigate('/financial/recorded-expenses')} />
      <FiscalDashboardSummary state={fiscal} />
      <FinanceSection title="Destinação de custos" description="Confira vínculos e valores que ainda precisam de destinação.">
        {currentTenant && user && <CostDispositionsPanel tenant={currentTenant.id} actor={user.id} />}
      </FinanceSection>
      <FinanceSection title="Conferência do período" description="Consulte as evidências e os registros de fechamento.">
        {currentTenant && user && <PeriodMoneyPackagePanel tenant={currentTenant.id} actor={user.id} />}
      </FinanceSection>
      <FinanceSection title="Fretes a faturar" description="Consulte a previsão de fretes com filtros próprios.">
      {currentTenant && user && (
        <UnbilledFreightPanel
          tenant={currentTenant.id}
          actor={user.id}
          clients={clients.map(client => ({ id: client.id, label: client.company_name }))}
        />
      )}
      </FinanceSection>
    </div>
  );
}
