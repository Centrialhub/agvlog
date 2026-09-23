import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, RefreshCw, TrendingUp, Truck, Users } from 'lucide-react';

import { useListFilters } from '@/hooks/useListFilters';
import { usePagination } from '@/hooks/usePagination';
import { useProductivityReportSummary } from '@/hooks/useProductivityReport';
import { useTenant } from '@/hooks/useTenant';
import { getErrorMessage } from '@/lib/errors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataPagination } from '@/components/ui/data-pagination';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function ProductivityReports() {
  const { currentTenant } = useTenant();
  const [, setSearchParams] = useSearchParams();
  const { filters, setFilter, resetFilters, activeCount } = useListFilters({ driver: 'all', vehicle: 'all', from: '', to: '' });
  const reportQuery = useProductivityReportSummary(filters);
  const report = reportQuery.data;
  const resetKey = `${currentTenant?.id}:${filters.driver}:${filters.vehicle}:${filters.from}:${filters.to}`;
  const drivers = usePagination(report?.driver_metrics ?? [], { pageSize: 20, resetKey });
  const clients = usePagination(report?.client_divergences ?? [], { pageSize: 20, resetKey });
  const vehicles = usePagination(report?.vehicle_efficiency ?? [], { pageSize: 20, resetKey });

  useEffect(() => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    next.delete('f_driver');
    next.delete('f_vehicle');
    return next;
  }, { replace: true }), [currentTenant?.id, setSearchParams]);

  if (reportQuery.isError) {
    return <div className="animate-fade-in space-y-6">
      <PageHeading />
      <Card className="border-destructive/50"><CardContent className="flex flex-col items-center gap-3 py-10 text-center" role="alert">
        <AlertTriangle className="h-7 w-7 text-destructive" />
        <div><p className="font-medium text-destructive">Não foi possível calcular o relatório</p><p className="text-sm text-muted-foreground">{getErrorMessage(reportQuery.error)}</p></div>
        <Button variant="outline" onClick={() => void reportQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente</Button>
      </CardContent></Card>
    </div>;
  }

  const chartData = (report?.driver_metrics ?? []).slice(0, 10).map(row => ({ name: row.name, entregas: row.deliveries, divergencias: row.divergences }));
  const optionsLimited = report?.driver_options_truncated || report?.vehicle_options_truncated;

  return <div className="animate-fade-in space-y-6">
    <PageHeading />
    <ListFilterBar fields={[
      { key: 'driver', label: 'Motorista', value: filters.driver, onChange: value => setFilter('driver', value), options: [{ value: 'all', label: 'Todos os motoristas' }, ...(report?.driver_options ?? []).map(row => ({ value: row.id, label: row.name }))] },
      { key: 'vehicle', label: 'Veículo', value: filters.vehicle, onChange: value => setFilter('vehicle', value), options: [{ value: 'all', label: 'Todos os veículos' }, ...(report?.vehicle_options ?? []).map(row => ({ value: row.id, label: row.nickname ? `${row.plate} (${row.nickname})` : row.plate }))] },
      { key: 'from', label: 'Registrado de', type: 'date', value: filters.from, max: filters.to || undefined, onChange: value => setFilter('from', value) },
      { key: 'to', label: 'Registrado até', type: 'date', value: filters.to, min: filters.from || undefined, onChange: value => setFilter('to', value) },
    ]} onReset={resetFilters} activeCount={activeCount} resultCount={report?.total_loads ?? 0} loading={reportQuery.isLoading}
      description={`Agregação calculada no servidor sobre o período selecionado. ${report?.total_events ?? 0} ocorrências no recorte.${optionsLimited ? ' As opções de filtro exibem as primeiras 500 entradas.' : ''}`} />

    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Kpi label="Taxa de Sucesso" value={report?.overall_success == null ? '—' : `${report.overall_success}%`} tone={report?.overall_success == null ? '' : report.overall_success >= 90 ? 'text-success' : 'text-warning'} />
      <Kpi label="Entregas" value={report?.total_delivered ?? 0} />
      <Kpi label="Divergências" value={report?.total_divergent ?? 0} tone="text-destructive" />
      <Kpi label="Impacto Financeiro" value={`R$ ${(report?.total_financial_impact ?? 0).toLocaleString('pt-BR')}`} tone="text-destructive" />
      <Kpi label="Paletes/Viagem" value={report?.avg_pallets_per_trip ?? 0} />
    </div>

    {chartData.length > 0 && <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Desempenho por Motorista</CardTitle></CardHeader><CardContent>
      <ResponsiveContainer width="100%" height={250}><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" className="stroke-border" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} /><Bar dataKey="entregas" fill="hsl(var(--success))" name="Entregas" radius={[4, 4, 0, 0]} /><Bar dataKey="divergencias" fill="hsl(var(--destructive))" name="Divergências" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
    </CardContent></Card>}

    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4" /> Motoristas</CardTitle></CardHeader><CardContent className="p-0">
        <Table><TableHeader><TableRow><TableHead>Motorista</TableHead><TableHead>Cargas</TableHead><TableHead>Pal/Viagem</TableHead><TableHead>Sucesso</TableHead></TableRow></TableHeader><TableBody>
          {drivers.totalCount === 0 ? <EmptyRow columns={4} label="Sem dados" /> : drivers.items.map(row => <TableRow key={row.id}><TableCell className="font-medium">{row.name}</TableCell><TableCell>{row.loads}</TableCell><TableCell>{row.avg_pallets}</TableCell><TableCell><div className="flex items-center gap-2">{row.success_rate === null ? <span className="text-xs text-muted-foreground">Sem amostra</span> : <><Progress aria-label={`Taxa de sucesso de ${row.name}`} aria-valuetext={`${row.success_rate}%`} value={row.success_rate} className={`h-2 w-12 ${row.success_rate < 80 ? '[&>div]:bg-destructive' : row.success_rate < 95 ? '[&>div]:bg-warning' : ''}`} /><span className={`text-xs font-medium ${row.success_rate < 80 ? 'text-destructive' : ''}`}>{row.success_rate}%</span></>}</div></TableCell></TableRow>)}
        </TableBody></Table><DataPagination {...drivers} onPageChange={drivers.setPage} />
      </CardContent></Card>

      <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-destructive" /> Divergências por Cliente</CardTitle></CardHeader><CardContent className="p-0">
        <Table><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Ocorrências</TableHead><TableHead>Impacto (R$)</TableHead></TableRow></TableHeader><TableBody>
          {clients.totalCount === 0 ? <EmptyRow columns={3} label="Nenhuma divergência 🎉" /> : clients.items.map(row => <TableRow key={row.id}><TableCell className="font-medium">{row.name}</TableCell><TableCell><Badge variant="outline" className="bg-destructive/10 text-destructive">{row.total}</Badge></TableCell><TableCell className="font-medium text-destructive">R$ {row.impact.toLocaleString('pt-BR')}</TableCell></TableRow>)}
        </TableBody></Table><DataPagination {...clients} onPageChange={clients.setPage} />
      </CardContent></Card>
    </div>

    <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium"><Truck className="h-4 w-4" /> Eficiência de Veículos</CardTitle></CardHeader><CardContent className="p-0">
      <Table><TableHeader><TableRow><TableHead>Veículo</TableHead><TableHead>Viagens</TableHead><TableHead>Paletes Total</TableHead><TableHead>Capacidade</TableHead><TableHead>Ocupação Média</TableHead></TableRow></TableHeader><TableBody>
        {vehicles.totalCount === 0 ? <EmptyRow columns={5} label="Configure capacidade dos veículos" /> : vehicles.items.map(row => <TableRow key={row.id}><TableCell className="font-medium">{row.plate}{row.nickname ? ` (${row.nickname})` : ''}</TableCell><TableCell>{row.trips}</TableCell><TableCell>{row.total_pallets}</TableCell><TableCell className="text-muted-foreground">{row.max_pallets} pal</TableCell><TableCell><div className="flex items-center gap-2"><Progress aria-label={`Ocupação média do veículo ${row.plate}`} aria-valuetext={`${row.avg_occupancy}%`} value={row.avg_occupancy} className={`h-2 w-16 ${row.avg_occupancy < 50 ? '[&>div]:bg-warning' : ''}`} /><span className={`text-xs font-medium ${row.avg_occupancy < 50 ? 'text-warning' : ''}`}>{row.avg_occupancy}%</span></div></TableCell></TableRow>)}
      </TableBody></Table><DataPagination {...vehicles} onPageChange={vehicles.setPage} />
    </CardContent></Card>
  </div>;
}

function PageHeading(){return <div><h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><TrendingUp className="h-6 w-6 text-primary" /> Relatórios de Produtividade</h1><p className="text-sm text-muted-foreground">Performance por motorista, divergências por cliente e eficiência de veículos</p></div>}
function Kpi({label,value,tone=''}:{label:string;value:string|number;tone?:string}){return <Card><CardContent className="pb-2 pt-3"><span className="text-[10px] text-muted-foreground">{label}</span><div className={`text-xl font-bold ${tone}`}>{value}</div></CardContent></Card>}
function EmptyRow({columns,label}:{columns:number;label:string}){return <TableRow><TableCell colSpan={columns} className="py-4 text-center text-sm text-muted-foreground">{label}</TableCell></TableRow>}
