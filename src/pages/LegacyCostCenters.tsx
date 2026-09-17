
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCostCenters } from '@/hooks/useCostCenters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowUpRight, ArrowDownRight, TrendingUp,
  Filter, BarChart3, PieChart as PieChartIcon,
  Calendar, Tag, FileDown
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { format, subDays } from 'date-fns';
import { CostCenterManager } from '@/components/cost-centers/CostCenterManager';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { cn } from '@/lib/utils';
import { csvSafeCell } from '@/lib/csvSafety';

const COLORS = [
  'hsl(215, 80%, 48%)', 'hsl(142, 64%, 38%)', 'hsl(38, 92%, 50%)',
  'hsl(0, 72%, 51%)', 'hsl(270, 60%, 55%)', 'hsl(180, 60%, 40%)',
];

type Period = '30d' | '90d' | 'all';

interface CostCenterTransaction {
  id: string;
  amount: number;
  description: string | null;
  cost_center: string | null;
  date: string;
  type: 'Pagável' | 'Recebível' | 'Banco' | 'Despesa' | 'Manutenção';
}

export default function CostCenters() {
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const { data: costCenters = [] } = useCostCenters();
  const [selectedCostCenter, setSelectedCostCenter] = useState<string>('all');
  const [period, setPeriod] = useState<Period>('30d');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const periodStart = period === '30d' ? format(subDays(new Date(), 30), 'yyyy-MM-dd')
    : period === '90d' ? format(subDays(new Date(), 90), 'yyyy-MM-dd') : null;

  const reportQuery = useQuery({
    queryKey: ['legacy_cost_center_report', currentTenant?.id, periodStart, selectedCostCenter, page],
    queryFn: async () => {
      if (!currentTenant) return null;
      const { data, error } = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)('get_legacy_cost_center_report_v1', {
        _tenant_id: currentTenant.id,
        _from: periodStart,
        _cost_center: selectedCostCenter === 'all' ? null : selectedCostCenter,
        _page: page,
        _page_size: pageSize,
      });
      if (error) throw error;
      const report = data as LegacyCostCenterReport;
      if (report.tenant_id !== currentTenant.id || report.page !== page || report.page_size !== pageSize) {
        throw new Error('Relatório legado fora do contexto solicitado.');
      }
      return report;
    },
    enabled: !!currentTenant,
  });
  const report = reportQuery.data;
  const filteredTransactions = report?.rows ?? [];
  const isLoading = reportQuery.isLoading;
  const stats = {
    totalOutflow: report?.total_outflow ?? Number.NaN,
    totalInflow: report?.total_inflow ?? Number.NaN,
    chartData: report?.chart_data ?? [],
  };

  const fmtCurrency = (v: number) => Number.isFinite(v) ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  const handleExport = () => {
    toast.info('Iniciando geração de relatório...');
    // Logic for actual report extraction would go here (CSV/Excel)
    const headers = ['Data', 'Descrição', 'Centro de Custo', 'Origem', 'Valor'];
    const rows = filteredTransactions.map(t => [
      format(new Date(t.date), 'dd/MM/yyyy'),
      t.description || '',
      t.cost_center || '',
      t.type,
      t.amount.toString()
    ]);

    const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.map(csvSafeCell).join(';')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_centros_custo_${format(new Date(), 'yyyyMMdd')}.csv`;
    link.click();
    toast.success('Relatório exportado com sucesso');
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Tag className="h-6 w-6 text-primary" /> Centros de Custo
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestão, categorias de gastos e KPIs financeiros
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!report || reportQuery.isError}>
            <FileDown className="h-4 w-4 mr-2" /> Exportar página
          </Button>
          <Select value={period} onValueChange={value => { setPage(1); setPeriod(value as Period); }}>
            <SelectTrigger className="w-[140px] h-9">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
              <SelectItem value="all">Todo o período</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {reportQuery.isError && (
        <Card role="alert" className="border-destructive/40">
          <CardContent className="space-y-3 py-6">
            <p className="text-destructive">Não foi possível consultar uma ou mais fontes do relatório legado. Nenhum total vazio foi inferido.</p>
            <Button variant="outline" onClick={() => void reportQuery.refetch()}>Tentar novamente</Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="management">Gerenciar Categorias</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="relative overflow-hidden border-destructive/20 bg-destructive/5">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                    <ArrowDownRight className="h-5 w-5 text-destructive" />
                  </div>
                  <Badge variant="outline" className="text-[10px]">Saída</Badge>
                </div>
                <p className="text-2xl font-bold tracking-tight">{fmtCurrency(stats.totalOutflow)}</p>
                <p className="text-xs text-muted-foreground mt-1">Total de despesas alocadas</p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden border-emerald-500/20 bg-emerald-500/5">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <ArrowUpRight className="h-5 w-5 text-emerald-600" />
                  </div>
                  <Badge variant="outline" className="text-[10px]">Entrada</Badge>
                </div>
                <p className="text-2xl font-bold tracking-tight">{fmtCurrency(stats.totalInflow)}</p>
                <p className="text-xs text-muted-foreground mt-1">Total de receitas alocadas</p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden border-primary/20 bg-primary/5">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <BarChart3 className="h-5 w-5 text-primary" />
                  </div>
                  <Badge variant="outline" className="text-[10px]">KPI</Badge>
                </div>
                <p className="text-2xl font-bold tracking-tight">{report?.total ?? '—'}</p>
                <p className="text-xs text-muted-foreground mt-1">Total de lançamentos vinculados</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" /> Histórico de Lançamentos
                </CardTitle>
                <Select value={selectedCostCenter} onValueChange={value => { setPage(1); setSelectedCostCenter(value); }}>
                  <SelectTrigger className="w-[180px] h-8 text-[10px]">
                    <Filter className="h-3.5 w-3.5 mr-2" />
                    <SelectValue placeholder="Filtrar Centro" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os centros</SelectItem>
                    {costCenters.map(cc => <SelectItem key={cc} value={cc}>{cc}</SelectItem>)}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Data</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead>Centro de Custo</TableHead>
                        <TableHead>Origem</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportQuery.isError ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-destructive">Histórico indisponível; nenhuma fonte foi tratada como vazia.</TableCell></TableRow>
                      ) : isLoading ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-8">Carregando...</TableCell></TableRow>
                      ) : filteredTransactions.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum lançamento encontrado.</TableCell></TableRow>
                      ) : (
                        filteredTransactions.map((t) => (
                          <TableRow key={`${t.type}:${t.id}`} className="group hover:bg-muted/50 transition-colors">
                            <TableCell className="text-xs">{format(new Date(t.date), 'dd/MM/yyyy')}</TableCell>
                            <TableCell className="text-xs font-medium max-w-[200px] truncate">{t.description || '-'}</TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px]">{t.cost_center}</Badge></TableCell>
                            <TableCell className="text-[10px] text-muted-foreground uppercase">{t.type}</TableCell>
                            <TableCell className={cn("text-right text-xs font-semibold", t.amount < 0 ? "text-red-500" : "text-emerald-600")}>
                              {fmtCurrency(t.amount)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between border-t p-3">
                  <Button variant="outline" disabled={page === 1 || isLoading} onClick={() => setPage(value => value - 1)}>Anterior</Button>
                  <span className="text-sm">Página {page} de {Math.max(1, Math.ceil((report?.total ?? 0) / pageSize))}</span>
                  <Button variant="outline" disabled={page * pageSize >= (report?.total ?? 0) || isLoading} onClick={() => setPage(value => value + 1)}>Próxima</Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <PieChartIcon className="h-4 w-4 text-primary" /> Distribuição de Despesas
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {reportQuery.isError ? (
                    <div className="flex items-center justify-center h-[280px] text-sm text-destructive">Distribuição indisponível.</div>
                  ) : stats.chartData.length > 0 ? (
                    <div className="h-[280px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={stats.chartData}
                            cx="50%" cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                            stroke="none"
                          >
                            {stats.chartData.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                            formatter={(value: number) => fmtCurrency(value)}
                          />
                          <Legend
                            layout="vertical"
                            verticalAlign="middle"
                            align="right"
                            wrapperStyle={{ fontSize: '10px' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                      Sem dados para exibição
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Resumo por Centro</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {stats.chartData.slice(0, 5).map((item, idx) => (
                      <div key={item.name} className="flex items-center justify-between p-3 text-xs">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          <span className="font-medium">{item.name}</span>
                        </div>
                        <span className="font-bold">{fmtCurrency(item.value)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="management">
          <Card>
            <CardHeader>
              <CardTitle>Gerenciamento de Centros de Custo</CardTitle>
            </CardHeader>
            <CardContent>
              <CostCenterManager />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface LegacyCostCenterReport {
  tenant_id: string;
  page: number;
  page_size: number;
  total: number;
  total_outflow: number;
  total_inflow: number;
  chart_data: Array<{ name: string; value: number }>;
  rows: CostCenterTransaction[];
}
