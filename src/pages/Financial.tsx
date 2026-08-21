import { useState, useMemo } from 'react';


import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useReceivables } from '@/hooks/useReceivables';
// import { useOperationalFinancialSummary } from '@/hooks/useOperationalFinancialSummary';
import { useClients, useClientsArray } from '@/hooks/useClients';
import { useCostCenters } from '@/hooks/useCostCenters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DollarSign, TrendingUp, TrendingDown, ArrowRight, Receipt,
  Search, Filter, FileText, AlertTriangle, CheckCircle, Clock,
  BarChart3, PieChart as PieChartIcon, Wallet, CreditCard,
  ArrowUpRight, ArrowDownRight, Calendar, Download, ChevronDown, X, SlidersHorizontal,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, Area, AreaChart, Legend,
} from 'recharts';
import { format, subDays, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { isBillableFiscalDoc, fiscalDocRevenue, isBillableNfse, nfseRevenue, isVoidFiscalStatus, isConfirmedFiscalDoc, isConfirmedNfse } from '@/lib/fiscal/documentStatus';

const COLORS = [
  'hsl(215, 80%, 48%)', 'hsl(142, 64%, 38%)', 'hsl(38, 92%, 50%)',
  'hsl(0, 72%, 51%)', 'hsl(270, 60%, 55%)', 'hsl(180, 60%, 40%)',
];

export default function Financial() {
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [docType, setDocType] = useState<string>('all');
  const [expenseCategory, setExpenseCategory] = useState<string>('all');
  const [selectedCostCenter, setSelectedCostCenter] = useState<string>('all');

  // ── Receivables ──
  const { data: receivables = [] } = useReceivables();

  // ── Fiscal Documents (NF-es inbound = entrada, CT-es outbound = receita frete) ──
  const { data: fiscalDocs = [] } = useQuery({
    queryKey: ['fin_fiscal', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('fiscal_documents')
        .select('id, document_type, value, weight_kg, freight_value, status, created_at, issue_date, client_id, invoice_number')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(1000);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Driver Expenses ──
  // ── NFS-e (receita de serviço) ──
  const { data: nfseDocs = [] } = useQuery({
    queryKey: ['fin_nfse', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('nfse_documents')
        .select('id, status, valor_servicos, valor_liquido, issue_date, created_at, cliente_id, cliente_nome, rps_number, nfse_number')
        .eq('tenant_id', currentTenant.id)
        .order('issue_date', { ascending: false })
        .limit(1000);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ['fin_expenses', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('driver_expenses')
        .select('id, amount, category, approval_status, expense_at, driver_id, notes, cost_center, drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .order('expense_at', { ascending: false })
        .limit(500);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Freight Calculation Logs ──
  const { data: freightLogs = [] } = useQuery({
    queryKey: ['fin_freight_logs', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('freight_calculation_log')
        .select('id, final_value, entity_type, created_at, freight_table_name')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(500);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Maintenance Orders (costs) ──
  const { data: maintenanceCosts = [] } = useQuery({
    queryKey: ['fin_maintenance', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('maintenance_orders')
        .select('id, total_cost, labor_cost, parts_cost, status, created_at, maintenance_type, cost_center')
        .eq('tenant_id', currentTenant.id)
        .limit(500);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const { data: clients = [] } = useClientsArray();
  const { data: costCenters = [] } = useCostCenters();

  // Documentos válidos (cancelados/rejeitados nunca entram em faturamento)
  const billableDocs = useMemo(() => fiscalDocs.filter((d: any) => isBillableFiscalDoc(d)), [fiscalDocs]);
  const voidDocs = useMemo(() => fiscalDocs.filter((d: any) => !isBillableFiscalDoc(d)), [fiscalDocs]);

  // NFS-e válidas (emitidas/em processamento) e canceladas/rejeitadas
  const billableNfse = useMemo(() => nfseDocs.filter((d: any) => isBillableNfse(d)), [nfseDocs]);
  const voidNfse = useMemo(
    () => nfseDocs.filter((d: any) => isVoidFiscalStatus((d as any).status)),
    [nfseDocs],
  );

  // Partes envolvidas: NF-e de entrada aponta para fornecedor, CT-e para cliente.
  const partyOptions = useMemo(() => {
    return clients
      .filter((c: any) => c.active !== false)
      .map((c: any) => ({
        id: c.id,
        label: c.company_name + (c.is_supplier && !c.is_client ? ' · Fornecedor' : c.is_supplier && c.is_client ? ' · Cliente/Fornecedor' : ' · Cliente'),
      }));
  }, [clients]);

  // ── Unique expense categories ──
  const expenseCategories = useMemo(() => {
    const cats = new Set(expenses.map((e: any) => e.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [expenses]);

  // ── Active filter count ──
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (dateFrom) count++;
    if (dateTo) count++;
    if (selectedClient !== 'all') count++;
    if (docType !== 'all') count++;
    if (expenseCategory !== 'all') count++;
    if (selectedCostCenter !== 'all') count++;
    return count;
  }, [dateFrom, dateTo, selectedClient, docType, expenseCategory, selectedCostCenter]);

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setSelectedClient('all');
    setDocType('all');
    setExpenseCategory('all');
    setSelectedCostCenter('all');
  };

  // ── Period filter ──
  const periodStart = useMemo(() => {
    if (dateFrom) return new Date(dateFrom);
    if (period === '7d') return subDays(new Date(), 7);
    if (period === '30d') return subDays(new Date(), 30);
    if (period === '90d') return subDays(new Date(), 90);
    return new Date('2000-01-01');
  }, [period, dateFrom]);

  const periodEnd = useMemo(() => {
    if (dateTo) return new Date(dateTo + 'T23:59:59');
    return new Date();
  }, [dateTo]);

  const filterByPeriod = (dateStr: string | null) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= periodStart && d <= periodEnd;
  };

  // ── Computed KPIs ──
  const summaryKpis: any = null;
  const isSummaryLoading = false;
  /*
  const { data: summaryKpis, isLoading: isSummaryLoading } = useOperationalFinancialSummary(
    dateFrom || (period === 'all' ? '' : format(subDays(new Date(), period === '7d' ? 7 : period === '30d' ? 30 : 90), 'yyyy-MM-dd')),
    dateTo || format(new Date(), 'yyyy-MM-dd')
  );
  */

  const kpis = useMemo(() => {
    let filteredDocs = billableDocs.filter((d: any) => filterByPeriod(d.issue_date || d.created_at));
    if (selectedClient !== 'all') filteredDocs = filteredDocs.filter((d: any) => d.client_id === selectedClient);
    if (docType !== 'all') filteredDocs = filteredDocs.filter((d: any) => d.document_type === docType);
    if (selectedCostCenter !== 'all') filteredDocs = filteredDocs.filter((d: any) => d.cost_center === selectedCostCenter);

    const nfes = filteredDocs.filter((d: any) => d.document_type === 'inbound');
    // Receita só de CT-e confirmado: rascunho/transmitindo ainda pode rejeitar.
    const ctes = filteredDocs.filter((d: any) => d.document_type === 'outbound' && isConfirmedFiscalDoc(d));

    let filteredNfse = billableNfse.filter((d: any) => filterByPeriod(d.issue_date || d.created_at));
    if (selectedClient !== 'all') filteredNfse = filteredNfse.filter((d: any) => d.cliente_id === selectedClient);
    if (docType !== 'all' && docType !== 'nfse') filteredNfse = [];
    const totalNfseValue = filteredNfse
      .filter((d: any) => isConfirmedNfse(d))
      .reduce((s: number, d: any) => s + nfseRevenue(d), 0);

    const totalNfeValue = nfes.reduce((s: number, d: any) => s + (Number(d.value) || 0), 0);
    // `value` do CT-e espelha o frete: usamos um único valor por documento
    const totalFreight = ctes.reduce((s: number, d: any) => s + fiscalDocRevenue(d), 0);
    const totalCteValue = totalFreight;
    const voidCount =
      voidDocs.filter((d: any) => filterByPeriod(d.issue_date || d.created_at)).length +
      voidNfse.filter((d: any) => filterByPeriod(d.issue_date || d.created_at)).length;

    let filteredExpenses = expenses.filter((e: any) => filterByPeriod(e.expense_at));
    if (expenseCategory !== 'all') filteredExpenses = filteredExpenses.filter((e: any) => e.category === expenseCategory);
    if (selectedCostCenter !== 'all') filteredExpenses = filteredExpenses.filter((e: any) => e.cost_center === selectedCostCenter);
    const totalExpenses = filteredExpenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
    const pendingExpenses = filteredExpenses.filter((e: any) => e.approval_status === 'pending');

    let filteredReceivables = receivables.filter((r: any) => filterByPeriod(r.created_at));
    if (selectedClient !== 'all') filteredReceivables = filteredReceivables.filter((r: any) => r.client_id === selectedClient);
    filteredReceivables = filteredReceivables.filter((r: any) => r.status !== 'cancelled');
    const today = new Date().toISOString().slice(0, 10);
    const isOpen = (r: any) => r.status === 'pending' || r.status === 'invoiced' || r.status === 'partial';
    const totalReceivable = filteredReceivables.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
    const pendingReceivable = filteredReceivables.filter(isOpen).reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
    const paidReceivable = filteredReceivables
      .filter((r: any) => r.status === 'received')
      .reduce((s: number, r: any) => s + (Number(r.received_amount ?? r.amount) || 0), 0);
    const overdueReceivable = filteredReceivables
      .filter((r: any) => isOpen(r) && r.due_date && r.due_date < today)
      .reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);

    let filteredMaint = maintenanceCosts.filter((m: any) => filterByPeriod(m.created_at));
    if (selectedCostCenter !== 'all') filteredMaint = filteredMaint.filter((m: any) => m.cost_center === selectedCostCenter);
    const totalMaintenance = filteredMaint.reduce((s: number, m: any) => s + (Number(m.total_cost) || 0), 0);

    const revenue = totalFreight + totalNfseValue;
    const outflow = totalExpenses + totalMaintenance;
    const balance = revenue - outflow;

    return {
      nfeCount: nfes.length, 
      cteCount: ctes.length,
      totalNfeValue, 
      totalCteValue, 
      totalFreight,
      nfseCount: filteredNfse.length, 
      totalNfseValue,
      voidCount,
      totalExpenses: summaryKpis?.totalExpenses ?? totalExpenses, 
      pendingExpensesCount: pendingExpenses.length,
      totalReceivable: summaryKpis?.totalReceivable ?? totalReceivable, 
      pendingReceivable: summaryKpis?.pendingReceivable ?? pendingReceivable, 
      paidReceivable: summaryKpis?.paidReceivable ?? paidReceivable, 
      overdueReceivable: summaryKpis?.overdueReceivable ?? overdueReceivable,
      totalMaintenance: summaryKpis?.totalMaintenance ?? totalMaintenance,
      revenue: summaryKpis?.revenue ?? revenue, 
      outflow: summaryKpis?.outflow ?? outflow, 
      balance: summaryKpis?.balance ?? balance,
      ledgerBalance: summaryKpis?.ledgerBalance ?? 0,
      receivablesCount: filteredReceivables.length,
    };
  }, [
    summaryKpis, billableDocs, voidDocs, billableNfse, voidNfse, expenses, receivables, 
    maintenanceCosts, periodStart, periodEnd, selectedClient, docType, expenseCategory, selectedCostCenter
  ]);

  // ── Chart: Revenue vs Expenses by day ──
  const revenueExpenseChart = useMemo(() => {
    const days: Record<string, { day: string; receita: number; despesa: number }> = {};

    billableDocs.filter((d: any) => d.document_type === 'outbound' && isConfirmedFiscalDoc(d) && filterByPeriod(d.issue_date || d.created_at)).forEach((d: any) => {
      const day = (d.issue_date || d.created_at?.slice(0, 10)) || '';
      if (!days[day]) days[day] = { day, receita: 0, despesa: 0 };
      days[day].receita += fiscalDocRevenue(d);
    });

    billableNfse.filter((d: any) => isConfirmedNfse(d) && filterByPeriod(d.issue_date || d.created_at)).forEach((d: any) => {
      const day = (d.issue_date || d.created_at?.slice(0, 10)) || '';
      if (!days[day]) days[day] = { day, receita: 0, despesa: 0 };
      days[day].receita += nfseRevenue(d);
    });

    expenses.filter((e: any) => filterByPeriod(e.expense_at)).forEach((e: any) => {
      const day = e.expense_at?.slice(0, 10) || '';
      if (!days[day]) days[day] = { day, receita: 0, despesa: 0 };
      days[day].despesa += Number(e.amount) || 0;
    });

    return Object.values(days)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(d => ({ ...d, day: d.day.length >= 10 ? format(new Date(d.day + 'T12:00:00'), 'dd/MM') : d.day }));
  }, [billableDocs, billableNfse, expenses, periodStart]);

  // ── Chart: Expense breakdown by category ──
  const expenseByCategoryChart = useMemo(() => {
    const cats: Record<string, number> = {};
    expenses.filter((e: any) => filterByPeriod(e.expense_at)).forEach((e: any) => {
      const cat = e.category || 'outros';
      cats[cat] = (cats[cat] || 0) + (Number(e.amount) || 0);
    });
    return Object.entries(cats).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [expenses, periodStart]);

  // ── Chart: Receivables status ──
  const receivablesChart = useMemo(() => {
    const statuses: Record<string, number> = {};
    receivables.filter((r: any) => filterByPeriod(r.created_at)).forEach((r: any) => {
      const s = r.status || 'pending';
      const amount = s === 'received' ? Number(r.received_amount ?? r.amount) || 0 : Number(r.amount) || 0;
      statuses[s] = (statuses[s] || 0) + amount;
    });
    const labels: Record<string, string> = { pending: 'Pendente', invoiced: 'Faturado', received: 'Recebido', partial: 'Parcial', cancelled: 'Cancelado' };
    return Object.entries(statuses).map(([status, value]) => ({ name: labels[status] || status, value }));
  }, [receivables, periodStart]);

  const fmtCurrency = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtCurrencyShort = (v: number) => {
    if (v >= 1000000) return `R$ ${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`;
    return `R$ ${v.toFixed(0)}`;
  };

  return (
    <div className="animate-fade-in space-y-5">


      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" /> Financeiro
          </h1>
          <p className="text-sm text-muted-foreground">
            Painel financeiro integrado · Receitas, despesas e contas a receber
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/receivables')}>
            <DollarSign className="h-4 w-4 mr-1" /> Contas a Receber
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/expense-approval')}>
            <Receipt className="h-4 w-4 mr-1" /> Despesas
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/driver-settlements')}>
            <Wallet className="h-4 w-4 mr-1" /> Acerto de Motoristas
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/ledger')}>
            <FileText className="h-4 w-4 mr-1" /> Razão Operacional
          </Button>
        </div>
      </div>


      {/* ── Collapsible Filter Bar ── */}
      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>

        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button
              variant={filtersOpen || activeFilterCount > 0 ? 'default' : 'outline'}
              size="sm"
              className="gap-2"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filtros Avançados
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-[10px]">
                  {activeFilterCount}
                </Badge>
              )}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${filtersOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>

          {/* Quick period pills */}
          <div className="flex bg-muted rounded-lg p-0.5">
            {(['7d', '30d', '90d', 'all'] as const).map(p => (
              <button
                key={p}
                onClick={() => { setPeriod(p); setDateFrom(''); setDateTo(''); }}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  period === p && !dateFrom ? 'bg-background text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p === '7d' ? '7 dias' : p === '30d' ? '30 dias' : p === '90d' ? '90 dias' : 'Tudo'}
              </button>
            ))}
          </div>

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground hover:text-foreground gap-1 text-xs">
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          )}
        </div>

        <CollapsibleContent className="mt-3">
          <Card className="border-dashed">
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {/* Date range */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Data início</label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Data fim</label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                {/* Client */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Cliente / Fornecedor</label>
                  <Select value={selectedClient} onValueChange={setSelectedClient}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos (clientes e fornecedores)</SelectItem>
                      {partyOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Document type */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Tipo Documento</label>
                  <Select value={docType} onValueChange={setDocType}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="inbound">NF-e Entrada</SelectItem>
                      <SelectItem value="outbound">CT-e / Saída</SelectItem>
                      <SelectItem value="transfer">Transferência</SelectItem>
                      <SelectItem value="nfse">NFS-e (serviço)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Expense category */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Categoria Despesa</label>
                  <Select value={expenseCategory} onValueChange={setExpenseCategory}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {expenseCategories.map((cat: string) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                    </Select>
                </div>

                {/* Cost Center */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Centro de Custo</label>
                  <Select value={selectedCostCenter} onValueChange={setSelectedCostCenter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {costCenters.map((cc: string) => (
                        <SelectItem key={cc} value={cc}>{cc}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Hero KPIs ── */}
      {kpis.voidCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          <p className="text-xs text-muted-foreground">
            {kpis.voidCount} documento(s) cancelado(s)/rejeitado(s) no período foram desconsiderados do faturamento.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="relative overflow-hidden border-primary/20 group hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/8 via-emerald-500/4 to-transparent" />
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-emerald-500/5 group-hover:bg-emerald-500/10 transition-colors" />
          <CardContent className="p-5 relative">
            <div className="flex items-center justify-between mb-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <ArrowUpRight className="h-5 w-5 text-emerald-600" />
              </div>
              <Badge variant="secondary" className="text-[10px] font-medium">receita</Badge>
            </div>
            <p className="text-2xl font-extrabold text-foreground tracking-tight">{fmtCurrencyShort(kpis.revenue)}</p>
            <p className="text-xs text-muted-foreground mt-1">Receita de frete + serviços</p>
            <p className="text-[10px] text-muted-foreground mt-2">{kpis.cteCount} CT-es · {kpis.nfseCount} NFS-e</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-destructive/20 group hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/8 via-red-500/4 to-transparent" />
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-red-500/5 group-hover:bg-red-500/10 transition-colors" />
          <CardContent className="p-5 relative">
            <div className="flex items-center justify-between mb-3">
              <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <ArrowDownRight className="h-5 w-5 text-red-600" />
              </div>
              <Badge variant="secondary" className="text-[10px] font-medium">saída</Badge>
            </div>
            <p className="text-2xl font-extrabold text-foreground tracking-tight">{fmtCurrencyShort(kpis.outflow)}</p>
            <p className="text-xs text-muted-foreground mt-1">Despesas + Manutenção</p>
            <p className="text-[10px] text-muted-foreground mt-2">
              {kpis.pendingExpensesCount > 0 && <span className="text-warning">{kpis.pendingExpensesCount} pendentes</span>}
            </p>
          </CardContent>
        </Card>

        <Card className={`relative overflow-hidden group hover:shadow-xl transition-all duration-300 ${kpis.balance >= 0 ? 'border-emerald-500/20' : 'border-destructive/20'}`}>
          <div className={`absolute inset-0 ${kpis.balance >= 0 ? 'bg-gradient-to-br from-emerald-500/8 to-transparent' : 'bg-gradient-to-br from-red-500/8 to-transparent'}`} />
          <CardContent className="p-5 relative">
            <div className="flex items-center justify-between mb-3">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${kpis.balance >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                <TrendingUp className={`h-5 w-5 ${kpis.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`} />
              </div>
              <Badge variant="secondary" className="text-[10px] font-medium">saldo</Badge>
            </div>
            <p className={`text-2xl font-extrabold tracking-tight ${kpis.balance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              {fmtCurrencyShort(kpis.balance)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Resultado do período</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-orange-500/20 group hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/8 via-orange-500/4 to-transparent" />
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-orange-500/5 group-hover:bg-orange-500/10 transition-colors" />
          <CardContent className="p-5 relative cursor-pointer" onClick={() => navigate('/ledger')}>
            <div className="flex items-center justify-between mb-3">
              <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-orange-600" />
              </div>
              <Badge variant="secondary" className="text-[10px] font-medium">razão</Badge>
            </div>
            <p className="text-2xl font-extrabold text-foreground tracking-tight">{fmtCurrencyShort(kpis.ledgerBalance)}</p>
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-muted-foreground">Saldo em Livro Razão</p>
              <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Secondary KPIs ── */}
      <div className="grid grid-cols-3 lg:grid-cols-7 gap-3">
        {[
          { icon: FileText, label: 'NF-es', value: kpis.nfeCount, sub: fmtCurrencyShort(kpis.totalNfeValue), color: 'text-blue-500' },
          { icon: Receipt, label: 'CT-es', value: kpis.cteCount, sub: fmtCurrencyShort(kpis.totalCteValue), color: 'text-emerald-500' },
          { icon: DollarSign, label: 'Frete Total', value: fmtCurrencyShort(kpis.totalFreight), sub: 'CT-e', color: 'text-green-600' },
          { icon: FileText, label: 'NFS-e', value: kpis.nfseCount, sub: fmtCurrencyShort(kpis.totalNfseValue), color: 'text-purple-500' },
          { icon: Receipt, label: 'Despesas Op.', value: fmtCurrencyShort(kpis.totalExpenses), sub: `${expenses.filter((e: any) => filterByPeriod(e.expense_at)).length} lançamentos`, color: 'text-red-500' },
          { icon: Wallet, label: 'Manutenção', value: fmtCurrencyShort(kpis.totalMaintenance), sub: 'custos', color: 'text-orange-500' },
          { icon: CheckCircle, label: 'Recebidos', value: fmtCurrencyShort(kpis.paidReceivable), sub: 'liquidados', color: 'text-teal-500' },
        ].map(({ icon: Icon, label, value, sub, color }) => (
          <Card key={label} className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`h-3.5 w-3.5 ${color}`} />
                <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
              </div>
              <p className="text-lg font-bold">{value}</p>
              <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Charts ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Revenue vs Expenses */}
        <Card className="lg:col-span-2 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Receita × Despesa
            </CardTitle>
          </CardHeader>
          <CardContent>
            {revenueExpenseChart.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={revenueExpenseChart} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v) => fmtCurrencyShort(v)} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}
                    formatter={(value: number, name: string) => [fmtCurrency(value), name === 'receita' ? 'Receita' : 'Despesa']}
                  />
                  <Legend formatter={(value) => value === 'receita' ? 'Receita' : 'Despesa'} />
                  <Bar dataKey="receita" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} name="receita" />
                  <Bar dataKey="despesa" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} name="despesa" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">
                Sem dados no período selecionado
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expense Categories Pie */}
        <Card className="shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <PieChartIcon className="h-4 w-4 text-primary" /> Despesas por Categoria
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {expenseByCategoryChart.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie
                      data={expenseByCategoryChart}
                      cx="50%" cy="50%"
                      innerRadius={45} outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {expenseByCategoryChart.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, background: 'hsl(var(--card))' }} formatter={(v: number) => fmtCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
                  {expenseByCategoryChart.map((entry, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <div className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-[10px] text-muted-foreground">{entry.name}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
                Sem despesas no período
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Receivables Chart ── */}
      {receivablesChart.length > 0 && (
        <Card className="shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" /> Contas a Receber por Status
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/receivables')}>
                Gerenciar <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {receivablesChart.map((entry, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                  <div className="h-3 w-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <div>
                    <p className="text-xs font-medium">{entry.name}</p>
                    <p className="text-sm font-bold">{fmtCurrency(entry.value)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Recent Transactions ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Recent Expenses */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4 text-destructive" /> Últimas Despesas
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/expense-approval')}>
                Ver todas <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {expenses.slice(0, 6).map((exp: any) => (
                <div key={exp.id} className="flex items-center justify-between py-2.5 px-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{exp.category}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {exp.drivers?.name || '—'} · {exp.expense_at ? format(new Date(exp.expense_at), 'dd/MM/yy', { locale: ptBR }) : '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold text-destructive">-{fmtCurrency(Number(exp.amount))}</span>
                    <Badge variant={exp.approval_status === 'approved' ? 'secondary' : exp.approval_status === 'pending' ? 'outline' : 'destructive'} className="text-[9px]">
                      {exp.approval_status === 'approved' ? 'Aprovada' : exp.approval_status === 'pending' ? 'Pendente' : 'Rejeitada'}
                    </Badge>
                  </div>
                </div>
              ))}
              {expenses.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">Nenhuma despesa registrada</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent CT-es / Revenue */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-emerald-600" /> Últimos CT-es
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/fiscal-documents')}>
                Ver todos <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {billableDocs.filter((d: any) => d.document_type === 'outbound').slice(0, 6).map((doc: any) => (
                <div key={doc.id} className="flex items-center justify-between py-2.5 px-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">CT-e {doc.invoice_number || '—'}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {doc.issue_date ? format(new Date(doc.issue_date + 'T12:00:00'), 'dd/MM/yy', { locale: ptBR }) : '—'}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-emerald-600">+{fmtCurrency(fiscalDocRevenue(doc))}</span>
                </div>
              ))}
              {billableDocs.filter((d: any) => d.document_type === 'outbound').length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">Nenhum CT-e emitido</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
