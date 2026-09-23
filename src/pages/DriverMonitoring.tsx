import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataPagination } from '@/components/ui/data-pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertTriangle, CheckCircle2, Clock, Download, FileSpreadsheet, MapPin, Truck, Upload, Users } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { localDateInputValue } from '@/lib/utils/formatDate';
import {
  useDriverMonitorsList, useDriverMonitorsReport, useDriverMonitorCommand, useAddProgressUpdate, useAddForecast,
  useMonitorUpdates, useMonitorForecasts,
  useImportDriverMonitoringWorkbook, type DriverMonitorRow,
  type DriverMonitoringFilters, DRIVER_MONITOR_PAGE_SIZE,
} from '@/hooks/useDriverMonitoring';
import { STATUS_LABELS, type DriverMonitorStatus } from '@/lib/driverMonitoring/driverMonitoringCalculator';
import { parseDriverMonitoringWorkbook, type ParsedDriverMonitoringWorkbook } from '@/lib/driverMonitoring/driverMonitoringSpreadsheetImport';
import { driversInRouteCsv, deliveriesByDriverCsv, arrivalForecastsCsv, downloadCsv } from '@/lib/driverMonitoring/driverMonitoringCsv';
import { driversInRoutePdf, deliveriesByDriverPdf, arrivalForecastsPdf, delaysPdf, productivityPdf, downloadPdf } from '@/lib/driverMonitoring/driverMonitoringPdf';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';
import { useTenant } from '@/hooks/useTenant';
import { toCompanyPdfInfo } from '@/lib/pdf/companyHeader';
import { driverMonitorCommandError } from '@/lib/driverMonitoring/driverMonitorCommands';
import { DriverAppObservabilityPanel } from '@/components/driver/DriverAppObservabilityPanel';

const dt = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '—');

const STATUS_VARIANT: Record<string, NonNullable<BadgeProps['variant']>> = {
  on_time: 'default', delayed: 'destructive', no_update: 'secondary',
  returning: 'default', arrived: 'default', completed: 'default',
  waiting_load: 'outline', cancelled: 'outline', active: 'secondary', issue: 'destructive',
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Falha inesperada';
const emptyMonitorForm = {
  driver_name: '', plate: '', total: 0, deadline: 0, planned_route: '', notes: '',
};
const ACTIVE_MONITOR_STATUSES = new Set(['active', 'on_time', 'delayed', 'no_update', 'returning', 'waiting_load', 'issue']);
const TERMINAL_MONITOR_STATUSES = new Set(['arrived', 'completed', 'cancelled']);

// eslint-disable-next-line react-refresh/only-export-components
export function isTerminalMonitorStatus(status: string): boolean {
  return TERMINAL_MONITOR_STATUSES.has(status);
}

// eslint-disable-next-line react-refresh/only-export-components
export function expectedReturnDate(startedAt: string, deadline: number): string | null {
  if (deadline <= 0) return null;
  const started = new Date(startedAt);
  if (!Number.isFinite(started.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(started);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const localDate = new Date(Date.UTC(value('year'), value('month') - 1, value('day') + deadline));
  return localDate.toISOString().slice(0, 10);
}

export default function DriverMonitoring() {
  const toast = useSonnerToast();
  const [filters, setFilters] = useState<DriverMonitoringFilters>({});
  const [applied, setApplied] = useState<DriverMonitoringFilters>({});
  const [page,setPage]=useState(1);
  const monitors=useDriverMonitorsList(applied,page);const rows=useMemo(()=>monitors.data?.rows??[],[monitors.data?.rows]);
  const reportMonitors=useDriverMonitorsReport(applied);const reportRows=useMemo(()=>reportMonitors.data??[],[reportMonitors.data]);
  const {isLoading,isError:monitorsIsError,error:monitorsError,refetch:refetchMonitors}=monitors;
  const { data: forecasts = [], isLoading: forecastsLoading, isError: forecastsIsError, error: forecastsError, refetch: refetchForecasts } = useMonitorForecasts(reportRows.map(row=>row.id));
  const { currentTenant } = useTenant();
  const { data: companyProfile } = useCompanyProfile();
  const companyInfo = toCompanyPdfInfo(companyProfile, currentTenant?.name);

  const [openRow, setOpenRow] = useState<DriverMonitorRow | null>(null);
  const { data: openUpdates = [], isLoading: updatesLoading, isError: updatesIsError, error: updatesError, refetch: refetchUpdates } = useMonitorUpdates(openRow?.id);

  const [createDlg, setCreateDlg] = useState(false);
  const [editRow, setEditRow] = useState<DriverMonitorRow | null>(null);
  const monitorCommand = useDriverMonitorCommand();
  const [monitorError, setMonitorError] = useState('');
  const [createForm, setCreateForm] = useState(emptyMonitorForm);
  const monitorFormInvalid = !createForm.driver_name.trim()
    || !Number.isInteger(createForm.total) || createForm.total <= 0
    || !Number.isInteger(createForm.deadline) || createForm.deadline < 0 || createForm.deadline > 3650;

  const [progDlg, setProgDlg] = useState<DriverMonitorRow | null>(null);
  const progMut = useAddProgressUpdate();
  const [progForm, setProgForm] = useState({
    date: localDateInputValue(), city: '', qty: 0,
    next_city: '', next_qty: '', finished_at: '', observation: '',
  });

  const [forecastDlg, setForecastDlg] = useState<DriverMonitorRow | null>(null);
  const forecastMut = useAddForecast();
  const [forecastForm, setForecastForm] = useState({
    forecast_date: localDateInputValue(), forecast_time: '',
    current_city: '', forecast_text: '', remaining_cities_text: '', observation: '',
  });

  const importMut = useImportDriverMonitoringWorkbook();
  const [parsed, setParsed] = useState<ParsedDriverMonitoringWorkbook | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const activeRows = useMemo(() => rows.filter((row) => ACTIVE_MONITOR_STATUSES.has(row.status)), [rows]);
  const activeReportRows = useMemo(() => reportRows.filter((row) => ACTIVE_MONITOR_STATUSES.has(row.status)), [reportRows]);
  const filteredForecasts = useMemo(() => {
    const monitorIds = new Set(rows.map((row) => row.id));
    return forecasts.filter((forecast) => monitorIds.has(forecast.monitor_id));
  }, [forecasts, rows]);

  useEffect(() => {
    if (!openRow) return;
    const fresh = rows.find((row) => row.id === openRow.id);
    if (fresh && (fresh.revision !== openRow.revision || fresh.updated_at !== openRow.updated_at)) setOpenRow(fresh);
  }, [rows, openRow]);

  const kpis = useMemo(() => {
    const today = localDateInputValue(new Date(),currentTenant?.timezone);
    const acc = {
      inRoute: 0, onTime: 0, delayed: 0, noUpdate: 0,
      predicted: 0, done: 0, remaining: 0,
      returningToday: 0, lateReturn: 0,
    };
    for (const r of reportRows) {
      if (['active', 'on_time', 'delayed', 'no_update', 'returning'].includes(r.status)) acc.inRoute++;
      if (r.status === 'on_time') acc.onTime++;
      if (r.status === 'delayed') acc.delayed++;
      if (r.status === 'no_update') acc.noUpdate++;
      acc.predicted += r.total_deliveries;
      acc.done += r.completed_deliveries;
      acc.remaining += r.remaining_deliveries;
      if (r.expected_return_date === today) acc.returningToday++;
      if (r.expected_return_date && r.expected_return_date < today && !r.actual_returned_at) acc.lateReturn++;
    }
    return acc;
  }, [reportRows,currentTenant?.timezone]);

  const applyFilters = () => {setPage(1);setApplied({ ...filters });};
  const clearFilters = () => { setPage(1);setFilters({}); setApplied({}); };
  const monitorTotal=monitors.data?.total??0;
  const monitorPageCount=Math.max(1,Math.ceil(monitorTotal/DRIVER_MONITOR_PAGE_SIZE));
  const monitorPagination={page,pageCount:monitorPageCount,totalCount:monitorTotal,
    start:monitorTotal?(page-1)*DRIVER_MONITOR_PAGE_SIZE+1:0,end:Math.min(page*DRIVER_MONITOR_PAGE_SIZE,monitorTotal),onPageChange:setPage};
  useEffect(()=>{if(page>monitorPageCount)setPage(monitorPageCount);},[page,monitorPageCount]);
  const openNewMonitor = () => {
    setEditRow(null);
    setCreateForm(emptyMonitorForm);
    setMonitorError('');
    setCreateDlg(true);
  };
  const openEditMonitor = (row: DriverMonitorRow) => {
    setEditRow(row);
    setCreateForm({
      driver_name: row.driver_name_snapshot || '',
      plate: row.vehicle_plate_snapshot || '',
      total: row.total_deliveries,
      deadline: row.return_deadline_days || 0,
      planned_route: row.planned_route_text || '',
      notes: row.notes || '',
    });
    setMonitorError('');
    setCreateDlg(true);
  };
  const recoverMonitor = async () => {
    setMonitorError('');
    try {
      await monitorCommand.recover();
      toast.success('Monitoramento recuperado e confirmado');
      setCreateDlg(false);
      setEditRow(null);
    } catch (error: unknown) {
      setMonitorError(driverMonitorCommandError(error));
    }
  };
  const arriveMonitor = async (row: DriverMonitorRow) => {
    setMonitorError('');
    try {
      await monitorCommand.submit({
        action: 'update',
        monitor_id: row.id,
        expected_revision: row.revision,
        reason: 'Chegada confirmada pela operação',
        changes: { status: 'arrived', actual_returned_at: new Date().toISOString() },
      });
      toast.success('Chegada confirmada');
    } catch (error: unknown) {
      setMonitorError(driverMonitorCommandError(error));
    }
  };
  const saveMonitor = async () => {
    if (monitorFormInvalid || monitorCommand.pending) {
      setMonitorError('Informe o motorista, ao menos uma entrega e um prazo de retorno entre 0 e 3650 dias; recupere qualquer alteração pendente.');
      return;
    }
    setMonitorError('');
    const startedAt = editRow?.started_at || new Date().toISOString();
    const changes = {
      driver_name_snapshot: createForm.driver_name.trim(),
      vehicle_plate_snapshot: createForm.plate.trim() || null,
      total_deliveries: createForm.total,
      return_deadline_days: createForm.deadline || null,
      expected_return_date: expectedReturnDate(startedAt, createForm.deadline),
      planned_route_text: createForm.planned_route.trim() || null,
      planned_cities: createForm.planned_route
        ? createForm.planned_route.split(/[,\n;/]/).map(value => value.trim()).filter(Boolean)
        : [],
      notes: createForm.notes.trim() || null,
    };
    try {
      await monitorCommand.submit(editRow ? {
        action: 'update',
        monitor_id: editRow.id,
        expected_revision: editRow.revision,
        reason: 'Cadastro do monitoramento editado pela operação',
        changes,
      } : {
        action: 'create',
        monitor_id: null,
        expected_revision: null,
        reason: 'Monitoramento cadastrado pela operação',
        changes: { ...changes, started_at: startedAt },
      });
      toast.success(editRow ? 'Monitoramento atualizado' : 'Monitoramento criado');
      setCreateDlg(false);
      setEditRow(null);
      setCreateForm(emptyMonitorForm);
    } catch (error: unknown) {
      setMonitorError(driverMonitorCommandError(error));
    }
  };

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (applied.status) parts.push(`Status: ${STATUS_LABELS[applied.status as DriverMonitorStatus] || applied.status}`);
    if (applied.plate) parts.push(`Placa: ${applied.plate}`);
    if (applied.currentCity) parts.push(`Cidade: ${applied.currentCity}`);
    if (applied.onlyDelayed) parts.push('Apenas atrasados');
    if (applied.onlyNoUpdate) parts.push('Apenas sem atualização');
    return parts.join('  |  ');
  }, [applied]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportFile(f);
    try {
      const buf = await f.arrayBuffer();
      const p = parseDriverMonitoringWorkbook(buf);
      setParsed(p);
      toast.success(`Prévia: ${p.monitors.length} motoristas, ${p.forecasts.length} previsões`);
    } catch (error: unknown) {
      toast.error('Erro ao ler planilha: ' + errorMessage(error));
    }
  }

  async function handleImportSave() {
    if (!importFile || !parsed) return;
    try {
      const r = await importMut.mutateAsync({ file: importFile, parsed });
      toast.success(`Importação: ${r.importedMonitors} motoristas, ${r.importedUpdates} atualizações, ${r.importedForecasts} previsões${r.errors.length ? ` (${r.errors.length} avisos)` : ''}`);
      setParsed(null);
      setImportFile(null);
    } catch (error: unknown) {
      toast.error('Erro ao importar: ' + errorMessage(error));
    }
  }

  const saveProgress = async () => {
    if (!progDlg || progMut.isPending) return;
    const current = rows.find((row) => row.id === progDlg.id) || progDlg;
    if (progForm.qty < 0 || progForm.qty > current.remaining_deliveries) {
      toast.error(`Informe entre 0 e ${current.remaining_deliveries} entregas restantes.`);
      return;
    }
    try {
      await progMut.mutateAsync({
        monitor_id: current.id,
        update_date: progForm.date,
        city: progForm.city,
        deliveries_completed_in_city: progForm.qty,
        next_city: progForm.next_city,
        next_city_deliveries: progForm.next_qty ? Number(progForm.next_qty) : null,
        city_finished_at: progForm.finished_at || null,
        observation: progForm.observation,
      });
      toast.success('Atualização registrada');
      setProgDlg(null);
      setProgForm({ date: localDateInputValue(), city: '', qty: 0, next_city: '', next_qty: '', finished_at: '', observation: '' });
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  };

  const saveForecast = async () => {
    if (!forecastDlg || forecastMut.isPending) return;
    try {
      await forecastMut.mutateAsync({ monitor_id: forecastDlg.id, ...forecastForm });
      toast.success('Previsão registrada');
      setForecastDlg(null);
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Monitoramento de Motoristas</h1>
          <p className="text-sm text-muted-foreground">Acompanhe rotas ativas, entregas realizadas e previsão de chegada.</p>
        </div>
        <Button onClick={openNewMonitor} disabled={monitorCommand.isPending || !!monitorCommand.pending}>
          <Truck className="h-4 w-4 mr-1" />Novo Monitoramento
        </Button>
      </div>

      {monitorCommand.pending ? (
        <Card role="alert">
          <CardContent className="p-3 flex flex-wrap items-center justify-between gap-2">
            <p>Há uma alteração de monitoramento sem confirmação. Recupere o mesmo pedido antes de continuar.</p>
            <Button variant="outline" onClick={() => void recoverMonitor()} disabled={monitorCommand.isPending}>
              {monitorCommand.isPending ? 'Recuperando…' : 'Recuperar alteração'}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {monitorCommand.recoveryError ? <p role="alert">{monitorCommand.recoveryError}</p> : null}
      {monitorError && !createDlg ? <p role="alert">{monitorError}</p> : null}
      {monitorsIsError && <Card role="alert"><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-destructive"><span>Não foi possível carregar os monitoramentos. {errorMessage(monitorsError)}</span><Button variant="outline" size="sm" onClick={() => refetchMonitors()}>Tentar novamente</Button></CardContent></Card>}
      {forecastsIsError && <Card role="alert"><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-destructive"><span>Não foi possível carregar as previsões. {errorMessage(forecastsError)}</span><Button variant="outline" size="sm" onClick={() => refetchForecasts()}>Tentar novamente</Button></CardContent></Card>}

      <Tabs defaultValue="panel">
        <TabsList>
          <TabsTrigger value="panel">Painel</TabsTrigger>
          <TabsTrigger value="routes">Rotas Ativas</TabsTrigger>
          <TabsTrigger value="daily">Registro Diário</TabsTrigger>
          <TabsTrigger value="arrival">Previsão de Chegada</TabsTrigger>
          <TabsTrigger value="reports">Relatórios</TabsTrigger>
          <TabsTrigger value="app-health">Saúde do app</TabsTrigger>
          <TabsTrigger value="import">Importar Planilha</TabsTrigger>
        </TabsList>

        <TabsContent value="panel" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard icon={<Users className="h-4 w-4" />} label="Em rota" value={reportMonitors.isError ? '—' : kpis.inRoute} />
            <KpiCard icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} label="No prazo" value={reportMonitors.isError ? '—' : kpis.onTime} />
            <KpiCard icon={<AlertTriangle className="h-4 w-4 text-destructive" />} label="Atrasados" value={reportMonitors.isError ? '—' : kpis.delayed} />
            <KpiCard icon={<Clock className="h-4 w-4" />} label="Sem atualização" value={reportMonitors.isError ? '—' : kpis.noUpdate} />
            <KpiCard icon={<MapPin className="h-4 w-4" />} label="Entregas restantes" value={reportMonitors.isError ? '—' : kpis.remaining} />
            <KpiCard icon={<Truck className="h-4 w-4" />} label="Retornos atrasados" value={reportMonitors.isError ? '—' : kpis.lateReturn} />
          </div>
          <MonitorsTable rows={rows} isLoading={isLoading} isError={monitorsIsError} error={monitorsError} onRetry={refetchMonitors} onOpen={setOpenRow} onProgress={setProgDlg}
            onForecast={setForecastDlg} onEdit={openEditMonitor} onArrive={arriveMonitor}
            commandBlocked={monitorCommand.isPending || !!monitorCommand.pending} />
          <DataPagination {...monitorPagination}/>
        </TabsContent>

        <TabsContent value="routes" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Input placeholder="Placa" value={filters.plate || ''} onChange={(e) => setFilters({ ...filters, plate: e.target.value })} />
              <Input placeholder="Cidade atual" value={filters.currentCity || ''} onChange={(e) => setFilters({ ...filters, currentCity: e.target.value })} />
              <Input placeholder="Próxima cidade" value={filters.nextCity || ''} onChange={(e) => setFilters({ ...filters, nextCity: e.target.value })} />
              <Select value={filters.status || '__all__'} onValueChange={(v) => setFilters({ ...filters, status: v === '__all__' ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!filters.onlyDelayed} onChange={(e) => setFilters({ ...filters, onlyDelayed: e.target.checked })} />
                Apenas atrasados
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!filters.onlyNoUpdate} onChange={(e) => setFilters({ ...filters, onlyNoUpdate: e.target.checked })} />
                Apenas sem atualização
              </label>
              <div className="flex gap-2 md:col-span-2">
                <Button onClick={applyFilters}>Aplicar</Button>
                <Button variant="ghost" onClick={clearFilters}>Limpar</Button>
              </div>
            </CardContent>
          </Card>
          <MonitorsTable rows={activeRows} isLoading={isLoading} isError={monitorsIsError} error={monitorsError} onRetry={refetchMonitors} onOpen={setOpenRow} onProgress={setProgDlg}
            onForecast={setForecastDlg} onEdit={openEditMonitor} onArrive={arriveMonitor}
            commandBlocked={monitorCommand.isPending || !!monitorCommand.pending} />
          <DataPagination {...monitorPagination}/>
        </TabsContent>

        <TabsContent value="daily" className="space-y-3">
          <div className="text-sm text-muted-foreground">Selecione uma rota para registrar entregas do dia por cidade.</div>
          <MonitorsTable rows={rows} isLoading={isLoading} isError={monitorsIsError} error={monitorsError} onRetry={refetchMonitors} onOpen={setOpenRow} onProgress={setProgDlg}
            onForecast={setForecastDlg} onEdit={openEditMonitor} onArrive={arriveMonitor}
            commandBlocked={monitorCommand.isPending || !!monitorCommand.pending} compact />
          <DataPagination {...monitorPagination}/>
        </TabsContent>

        <TabsContent value="arrival" className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Previsões de Chegada em Montes Claros</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={forecastsIsError || forecastsLoading} onClick={() => downloadCsv('previsoes.csv', arrivalForecastsCsv(filteredForecasts))}><Download className="h-4 w-4 mr-1" />CSV</Button>
                <Button size="sm" variant="outline" disabled={forecastsIsError || forecastsLoading} onClick={() => downloadPdf(arrivalForecastsPdf(filteredForecasts, filterSummary, companyInfo), 'previsoes.pdf')}><Download className="h-4 w-4 mr-1" />PDF</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Data</TableHead><TableHead>Hora</TableHead><TableHead>Motorista</TableHead>
                  <TableHead>Cidade atual</TableHead><TableHead>Previsão</TableHead>
                  <TableHead>Cidades restantes</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {forecastsIsError ? <TableRow><TableCell colSpan={7} className="text-center text-destructive">Previsões indisponíveis. <Button variant="link" onClick={() => refetchForecasts()}>Tentar novamente</Button></TableCell></TableRow> : forecastsLoading ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Carregando previsões…</TableCell></TableRow> : filteredForecasts.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nenhuma previsão registrada</TableCell></TableRow>}
                  {!forecastsIsError && filteredForecasts.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>{dt(f.forecast_date)}</TableCell>
                      <TableCell>{f.forecast_time?.slice(0, 5) || '—'}</TableCell>
                      <TableCell>{f.driver_name || '—'}</TableCell>
                      <TableCell>{f.current_city || '—'}</TableCell>
                      <TableCell>{f.forecast_text || '—'}</TableCell>
                      <TableCell className="max-w-xs truncate">{f.remaining_cities_text || '—'}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[f.status] || 'outline'}>{STATUS_LABELS[f.status as DriverMonitorStatus] || f.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ReportCard title="Motoristas em Rota" onCsv={() => downloadCsv('motoristas-em-rota.csv', driversInRouteCsv(activeReportRows))} onPdf={() => downloadPdf(driversInRoutePdf(activeReportRows, filterSummary, companyInfo), 'motoristas-em-rota.pdf')} disabled={reportMonitors.isError||reportMonitors.isFetching} disabledHint="Os monitoramentos completos precisam estar disponíveis." />
            <ReportCard title="Entregas por Motorista" onCsv={() => downloadCsv('entregas-por-motorista.csv', deliveriesByDriverCsv(openUpdates))} onPdf={() => downloadPdf(deliveriesByDriverPdf(openUpdates, filterSummary, companyInfo), 'entregas-por-motorista.pdf')} disabled={!openRow || updatesIsError} disabledHint={updatesIsError ? 'As atualizações da rota estão indisponíveis.' : 'Abra uma rota para exportar suas entregas.'} />
            <ReportCard title="Chegada de Veículos" onCsv={() => downloadCsv('chegadas.csv', arrivalForecastsCsv(filteredForecasts))} onPdf={() => downloadPdf(arrivalForecastsPdf(filteredForecasts, filterSummary, companyInfo), 'chegadas.pdf')} disabled={forecastsIsError} disabledHint="As previsões precisam estar disponíveis." />
            <ReportCard title="Atrasos" onCsv={() => downloadCsv('atrasos.csv', driversInRouteCsv(reportRows.filter((r) => r.status === 'delayed')))} onPdf={() => downloadPdf(delaysPdf(reportRows.filter((r) => r.status === 'delayed'), filterSummary, companyInfo), 'atrasos.pdf')} disabled={reportMonitors.isError||reportMonitors.isFetching} disabledHint="Os monitoramentos completos precisam estar disponíveis." />
            <ReportCard title="Produtividade" onCsv={() => downloadCsv('produtividade.csv', driversInRouteCsv(reportRows))} onPdf={() => downloadPdf(productivityPdf(reportRows, filterSummary, companyInfo), 'produtividade.pdf')} disabled={reportMonitors.isError||reportMonitors.isFetching} disabledHint="Os monitoramentos completos precisam estar disponíveis." />
          </div>
        </TabsContent>

        <TabsContent value="app-health" className="space-y-3">
          <DriverAppObservabilityPanel />
        </TabsContent>

        <TabsContent value="import" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" />Importar Planilha Legada</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <input type="file" accept=".xlsx,.xls" onChange={handleFileSelect} className="text-sm" />
              {parsed && (
                <div className="text-sm space-y-2">
                  <div>Motoristas encontrados: <b>{parsed.monitors.length}</b> | Atualizações: <b>{parsed.monitors.reduce((s, m) => s + m.updates.length, 0)}</b> | Previsões: <b>{parsed.forecasts.length}</b></div>
                  {parsed.errors.length > 0 && (
                    <div className="text-destructive">{parsed.errors.length} avisos detectados</div>
                  )}
                  <Button onClick={handleImportSave} disabled={importMut.isPending}>
                    <Upload className="h-4 w-4 mr-1" />
                    {importMut.isPending ? 'Importando...' : 'Confirmar importação'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create/edit monitor */}
      <Dialog open={createDlg} onOpenChange={(open) => {
        if (!open && !monitorCommand.isPending) {
          setCreateDlg(false);
          setEditRow(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editRow ? 'Editar Monitoramento' : 'Novo Monitoramento'}</DialogTitle>
            <DialogDescription>
              A alteração só será concluída após confirmação atômica do registro e do histórico.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={monitorCommand.isPending || !!monitorCommand.pending} className="space-y-3">
            <div><Label htmlFor="monitor-driver-name">Motorista</Label><Input id="monitor-driver-name" value={createForm.driver_name} onChange={(e) => setCreateForm({ ...createForm, driver_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="monitor-plate">Placa</Label><Input id="monitor-plate" value={createForm.plate} onChange={(e) => setCreateForm({ ...createForm, plate: e.target.value })} /></div>
              <div><Label htmlFor="monitor-total">Total entregas</Label><Input id="monitor-total" type="number" min={1} value={createForm.total} onChange={(e) => setCreateForm({ ...createForm, total: Number(e.target.value) })} /></div>
              <div><Label htmlFor="monitor-deadline">Prazo retorno (dias)</Label><Input id="monitor-deadline" type="number" min={0} max={3650} value={createForm.deadline} onChange={(e) => setCreateForm({ ...createForm, deadline: Number(e.target.value) })} /></div>
            </div>
            <div><Label htmlFor="monitor-route">Rota planejada</Label><Textarea id="monitor-route" maxLength={8000} value={createForm.planned_route} onChange={(e) => setCreateForm({ ...createForm, planned_route: e.target.value })} /></div>
            <div><Label htmlFor="monitor-notes">Observações</Label><Textarea id="monitor-notes" maxLength={4000} value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} /></div>
          </fieldset>
          {monitorError ? <p role="alert">{monitorError}</p> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDlg(false)} disabled={monitorCommand.isPending}>Cancelar</Button>
            {monitorCommand.pending ? (
              <Button variant="outline" onClick={() => void recoverMonitor()} disabled={monitorCommand.isPending}>
                {monitorCommand.isPending ? 'Recuperando…' : 'Recuperar alteração'}
              </Button>
            ) : null}
            <Button onClick={() => void saveMonitor()}
              disabled={monitorCommand.isPending || !!monitorCommand.pending || monitorFormInvalid}>
              {monitorCommand.isPending ? 'Salvando…' : editRow ? 'Salvar alterações' : 'Criar monitoramento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Progress update */}
      <Dialog open={!!progDlg} onOpenChange={(o) => !o && setProgDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Entregas do Dia — {progDlg?.driver_name_snapshot}</DialogTitle>
            <DialogDescription>Registre a posição e o progresso diário das entregas desta rota.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Data</Label><Input type="date" value={progForm.date} onChange={(e) => setProgForm({ ...progForm, date: e.target.value })} /></div>
              <div><Label>Cidade</Label><Input value={progForm.city} onChange={(e) => setProgForm({ ...progForm, city: e.target.value })} /></div>
              <div><Label>Entregas na cidade</Label><Input type="number" min={0} max={progDlg?.remaining_deliveries ?? 0} value={progForm.qty} onChange={(e) => setProgForm({ ...progForm, qty: Number(e.target.value) })} /></div>
              <div><Label>Horário término</Label><Input type="time" value={progForm.finished_at} onChange={(e) => setProgForm({ ...progForm, finished_at: e.target.value })} /></div>
              <div><Label>Próxima cidade</Label><Input value={progForm.next_city} onChange={(e) => setProgForm({ ...progForm, next_city: e.target.value })} /></div>
              <div><Label>Entregas próxima</Label><Input type="number" value={progForm.next_qty} onChange={(e) => setProgForm({ ...progForm, next_qty: e.target.value })} /></div>
            </div>
            <div><Label>Observação</Label><Textarea value={progForm.observation} onChange={(e) => setProgForm({ ...progForm, observation: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setProgDlg(null)} disabled={progMut.isPending}>Cancelar</Button>
            <Button onClick={() => void saveProgress()} disabled={progMut.isPending}>{progMut.isPending ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Forecast */}
      <Dialog open={!!forecastDlg} onOpenChange={(o) => !o && setForecastDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atualizar Previsão de Chegada — {forecastDlg?.driver_name_snapshot}</DialogTitle>
            <DialogDescription>Informe a localização atual e a nova previsão de chegada do motorista.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Data</Label><Input type="date" value={forecastForm.forecast_date} onChange={(e) => setForecastForm({ ...forecastForm, forecast_date: e.target.value })} /></div>
              <div><Label>Hora</Label><Input type="time" value={forecastForm.forecast_time} onChange={(e) => setForecastForm({ ...forecastForm, forecast_time: e.target.value })} /></div>
              <div><Label>Cidade atual</Label><Input value={forecastForm.current_city} onChange={(e) => setForecastForm({ ...forecastForm, current_city: e.target.value })} /></div>
              <div><Label>Previsão em Montes Claros</Label><Input value={forecastForm.forecast_text} onChange={(e) => setForecastForm({ ...forecastForm, forecast_text: e.target.value })} placeholder="ex.: Sábado 09 horas" /></div>
            </div>
            <div><Label>Cidades restantes</Label><Textarea value={forecastForm.remaining_cities_text} onChange={(e) => setForecastForm({ ...forecastForm, remaining_cities_text: e.target.value })} /></div>
            <div><Label>Observação</Label><Textarea value={forecastForm.observation} onChange={(e) => setForecastForm({ ...forecastForm, observation: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForecastDlg(null)} disabled={forecastMut.isPending}>Cancelar</Button>
            <Button onClick={() => void saveForecast()} disabled={forecastMut.isPending}>{forecastMut.isPending ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Open monitor detail */}
      <Dialog open={!!openRow} onOpenChange={(o) => !o && setOpenRow(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{openRow?.monitor_number} — {openRow?.driver_name_snapshot}</DialogTitle>
            <DialogDescription>Consulte o progresso, a rota planejada e as atualizações diárias deste monitoramento.</DialogDescription>
          </DialogHeader>
          {openRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><b>Placa:</b> {openRow.vehicle_plate_snapshot || '—'}</div>
                <div><b>Carga:</b> {openRow.load_number || '—'}</div>
                <div><b>Total entregas:</b> {openRow.total_deliveries}</div>
                <div><b>Realizadas:</b> {openRow.completed_deliveries} ({openRow.progress_percent}%)</div>
                <div><b>Faltantes:</b> {openRow.remaining_deliveries}</div>
                <div><b>Prazo retorno:</b> {dt(openRow.expected_return_date)}</div>
                <div><b>Cidade atual:</b> {openRow.current_city || '—'}</div>
                <div><b>Próxima:</b> {openRow.next_city || '—'}</div>
                <div className="col-span-2"><b>Rota planejada:</b> {openRow.planned_route_text || '—'}</div>
                <div className="col-span-2"><b>Previsão chegada:</b> {openRow.arrival_forecast_text || '—'}</div>
              </div>
              <div>
                <h4 className="font-semibold mb-1">Atualizações diárias</h4>
                <Table>
                  <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Cidade</TableHead><TableHead>Entregas</TableHead><TableHead>Próxima</TableHead><TableHead>Obs.</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {updatesIsError ? <TableRow><TableCell colSpan={5} className="text-destructive">Atualizações indisponíveis. {errorMessage(updatesError)} <Button variant="link" onClick={() => refetchUpdates()}>Tentar novamente</Button></TableCell></TableRow> : updatesLoading ? <TableRow><TableCell colSpan={5} className="text-muted-foreground">Carregando atualizações…</TableCell></TableRow> : openUpdates.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sem atualizações</TableCell></TableRow>}
                    {!updatesIsError && openUpdates.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>{dt(u.update_date)}</TableCell>
                        <TableCell>{u.city || '—'}</TableCell>
                        <TableCell>{u.deliveries_completed_in_city}</TableCell>
                        <TableCell>{u.next_city || '—'}</TableCell>
                        <TableCell className="max-w-xs truncate">{u.observation || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function ReportCard({ title, onCsv, onPdf, disabled, disabledHint }: { title: string; onCsv: () => void; onPdf: () => void; disabled?: boolean; disabledHint?: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2">
        {disabled && disabledHint && <div className="text-xs text-muted-foreground">{disabledHint}</div>}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onCsv} disabled={disabled}><Download className="h-4 w-4 mr-1" />CSV</Button>
          <Button size="sm" variant="outline" onClick={onPdf} disabled={disabled}><Download className="h-4 w-4 mr-1" />PDF</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MonitorsTable({
  rows, isLoading, isError, error, onRetry, onOpen, onProgress, onForecast, onEdit, onArrive, commandBlocked, compact,
}: {
  rows: DriverMonitorRow[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => unknown;
  onOpen: (r: DriverMonitorRow) => void;
  onProgress: (r: DriverMonitorRow) => void;
  onForecast: (r: DriverMonitorRow) => void;
  onEdit: (r: DriverMonitorRow) => void;
  onArrive: (r: DriverMonitorRow) => Promise<void>;
  commandBlocked: boolean;
  compact?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Motorista</TableHead>
              <TableHead>Placa</TableHead>
              <TableHead>Carga</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Real.</TableHead>
              <TableHead>Falt.</TableHead>
              <TableHead>Progresso</TableHead>
              <TableHead>Cidade atual</TableHead>
              <TableHead>Próxima</TableHead>
              <TableHead>Prazo</TableHead>
              <TableHead>Status</TableHead>
              {!compact && <TableHead className="text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? <TableRow><TableCell colSpan={12} className="text-center text-destructive">Monitoramentos indisponíveis. {errorMessage(error)} <Button variant="link" onClick={() => onRetry()}>Tentar novamente</Button></TableCell></TableRow> : isLoading ? <TableRow><TableCell colSpan={12} className="text-center">Carregando…</TableCell></TableRow> : rows.length === 0 && <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground">Nenhum monitoramento encontrado</TableCell></TableRow>}
            {!isError && rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r)}>
                <TableCell>{r.driver_name_snapshot || '—'}</TableCell>
                <TableCell>{r.vehicle_plate_snapshot || '—'}</TableCell>
                <TableCell>{r.load_number || '—'}</TableCell>
                <TableCell>{r.total_deliveries}</TableCell>
                <TableCell>{r.completed_deliveries}</TableCell>
                <TableCell>{r.remaining_deliveries}</TableCell>
                <TableCell>{r.progress_percent}%</TableCell>
                <TableCell>{r.current_city || '—'}</TableCell>
                <TableCell>{r.next_city || '—'}</TableCell>
                <TableCell>{dt(r.expected_return_date)}</TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[r.status] || 'outline'}>{STATUS_LABELS[r.status as DriverMonitorStatus] || r.status}</Badge></TableCell>
                {!compact && (
                  <TableCell className="text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const terminal = isTerminalMonitorStatus(r.status);
                      const actionUnavailable = commandBlocked || terminal;
                      const closedHint = terminal ? 'Monitoramento encerrado' : undefined;
                      return <>
                    <Button size="sm" variant="outline" onClick={() => onEdit(r)} disabled={commandBlocked}>Editar</Button>
                    <Button size="sm" variant="outline" title={closedHint} onClick={() => onProgress(r)} disabled={actionUnavailable}>Registrar</Button>
                    <Button size="sm" variant="outline" title={closedHint} onClick={() => onForecast(r)} disabled={actionUnavailable}>Previsão</Button>
                    {!terminal && (
                      <Button size="sm" variant="ghost" disabled={commandBlocked}
                        onClick={() => void onArrive(r)}>Chegou</Button>
                    )}
                      </>;
                    })()}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
