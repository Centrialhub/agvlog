import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertTriangle, CheckCircle2, Clock, Download, FileSpreadsheet, MapPin, Truck, Upload, Users } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import {
  useDriverMonitorsList, useCreateMonitor, useAddProgressUpdate, useAddForecast,
  useUpdateMonitorStatus, useMonitorUpdates, useMonitorForecasts,
  useImportDriverMonitoringWorkbook, type DriverMonitorRow,
  type DriverMonitoringFilters,
} from '@/hooks/useDriverMonitoring';
import { STATUS_LABELS, type DriverMonitorStatus } from '@/lib/driverMonitoring/driverMonitoringCalculator';
import { parseDriverMonitoringWorkbook, type ParsedDriverMonitoringWorkbook } from '@/lib/driverMonitoring/driverMonitoringSpreadsheetImport';
import { driversInRouteCsv, deliveriesByDriverCsv, arrivalForecastsCsv, downloadCsv } from '@/lib/driverMonitoring/driverMonitoringCsv';
import { driversInRoutePdf, deliveriesByDriverPdf, arrivalForecastsPdf, delaysPdf, productivityPdf, downloadPdf } from '@/lib/driverMonitoring/driverMonitoringPdf';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';
import { useTenant } from '@/hooks/useTenant';
import { toCompanyPdfInfo } from '@/lib/pdf/companyHeader';

const dt = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '—');

const STATUS_VARIANT: Record<string, NonNullable<BadgeProps['variant']>> = {
  on_time: 'default', delayed: 'destructive', no_update: 'secondary',
  returning: 'default', arrived: 'default', completed: 'default',
  waiting_load: 'outline', cancelled: 'outline', active: 'secondary', issue: 'destructive',
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Falha inesperada';

export default function DriverMonitoring() {
  const [filters, setFilters] = useState<DriverMonitoringFilters>({});
  const [applied, setApplied] = useState<DriverMonitoringFilters>({});
  const { data: rows = [], isLoading } = useDriverMonitorsList(applied);
  const { data: forecasts = [] } = useMonitorForecasts();
  const { currentTenant } = useTenant();
  const { data: companyProfile } = useCompanyProfile();
  const companyInfo = toCompanyPdfInfo(companyProfile, currentTenant?.name);

  const [openRow, setOpenRow] = useState<DriverMonitorRow | null>(null);
  const { data: openUpdates = [] } = useMonitorUpdates(openRow?.id);

  const [createDlg, setCreateDlg] = useState(false);
  const createMut = useCreateMonitor();
  const [createForm, setCreateForm] = useState({
    driver_name: '', plate: '', total: 0, deadline: 0, planned_route: '', notes: '',
  });

  const [progDlg, setProgDlg] = useState<DriverMonitorRow | null>(null);
  const progMut = useAddProgressUpdate();
  const [progForm, setProgForm] = useState({
    date: new Date().toISOString().slice(0, 10), city: '', qty: 0,
    next_city: '', next_qty: '', finished_at: '', observation: '',
  });

  const [forecastDlg, setForecastDlg] = useState<DriverMonitorRow | null>(null);
  const forecastMut = useAddForecast();
  const [forecastForm, setForecastForm] = useState({
    forecast_date: new Date().toISOString().slice(0, 10), forecast_time: '',
    current_city: '', forecast_text: '', remaining_cities_text: '', observation: '',
  });

  const updMut = useUpdateMonitorStatus();

  const importMut = useImportDriverMonitoringWorkbook();
  const [parsed, setParsed] = useState<ParsedDriverMonitoringWorkbook | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);

  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const acc = {
      inRoute: 0, onTime: 0, delayed: 0, noUpdate: 0,
      predicted: 0, done: 0, remaining: 0,
      returningToday: 0, lateReturn: 0,
    };
    for (const r of rows) {
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
  }, [rows]);

  const applyFilters = () => setApplied({ ...filters });
  const clearFilters = () => { setFilters({}); setApplied({}); };

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

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Monitoramento de Motoristas</h1>
          <p className="text-sm text-muted-foreground">Acompanhe rotas ativas, entregas realizadas e previsão de chegada.</p>
        </div>
        <Button onClick={() => setCreateDlg(true)}><Truck className="h-4 w-4 mr-1" />Novo Monitoramento</Button>
      </div>

      <Tabs defaultValue="panel">
        <TabsList>
          <TabsTrigger value="panel">Painel</TabsTrigger>
          <TabsTrigger value="routes">Rotas Ativas</TabsTrigger>
          <TabsTrigger value="daily">Registro Diário</TabsTrigger>
          <TabsTrigger value="arrival">Previsão de Chegada</TabsTrigger>
          <TabsTrigger value="reports">Relatórios</TabsTrigger>
          <TabsTrigger value="import">Importar Planilha</TabsTrigger>
        </TabsList>

        <TabsContent value="panel" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard icon={<Users className="h-4 w-4" />} label="Em rota" value={kpis.inRoute} />
            <KpiCard icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} label="No prazo" value={kpis.onTime} />
            <KpiCard icon={<AlertTriangle className="h-4 w-4 text-destructive" />} label="Atrasados" value={kpis.delayed} />
            <KpiCard icon={<Clock className="h-4 w-4" />} label="Sem atualização" value={kpis.noUpdate} />
            <KpiCard icon={<MapPin className="h-4 w-4" />} label="Entregas restantes" value={kpis.remaining} />
            <KpiCard icon={<Truck className="h-4 w-4" />} label="Retornos atrasados" value={kpis.lateReturn} />
          </div>
          <MonitorsTable rows={rows} isLoading={isLoading} onOpen={setOpenRow} onProgress={setProgDlg} onForecast={setForecastDlg} onUpdate={updMut} />
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
          <MonitorsTable rows={rows} isLoading={isLoading} onOpen={setOpenRow} onProgress={setProgDlg} onForecast={setForecastDlg} onUpdate={updMut} />
        </TabsContent>

        <TabsContent value="daily" className="space-y-3">
          <div className="text-sm text-muted-foreground">Selecione uma rota para registrar entregas do dia por cidade.</div>
          <MonitorsTable rows={rows} isLoading={isLoading} onOpen={setOpenRow} onProgress={setProgDlg} onForecast={setForecastDlg} onUpdate={updMut} compact />
        </TabsContent>

        <TabsContent value="arrival" className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Previsões de Chegada em Montes Claros</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadCsv('previsoes.csv', arrivalForecastsCsv(forecasts))}><Download className="h-4 w-4 mr-1" />CSV</Button>
                <Button size="sm" variant="outline" onClick={() => downloadPdf(arrivalForecastsPdf(forecasts, undefined, companyInfo), 'previsoes.pdf')}><Download className="h-4 w-4 mr-1" />PDF</Button>
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
                  {forecasts.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nenhuma previsão registrada</TableCell></TableRow>}
                  {forecasts.map((f) => (
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
            <ReportCard title="Motoristas em Rota" onCsv={() => downloadCsv('motoristas-em-rota.csv', driversInRouteCsv(rows))} onPdf={() => downloadPdf(driversInRoutePdf(rows, filterSummary, companyInfo), 'motoristas-em-rota.pdf')} />
            <ReportCard title="Entregas por Motorista" onCsv={() => downloadCsv('entregas-por-motorista.csv', deliveriesByDriverCsv(openUpdates))} onPdf={() => downloadPdf(deliveriesByDriverPdf(openUpdates, filterSummary, companyInfo), 'entregas-por-motorista.pdf')} disabled={!openRow} disabledHint="Abra uma rota para exportar suas entregas." />
            <ReportCard title="Chegada de Veículos" onCsv={() => downloadCsv('chegadas.csv', arrivalForecastsCsv(forecasts))} onPdf={() => downloadPdf(arrivalForecastsPdf(forecasts, filterSummary, companyInfo), 'chegadas.pdf')} />
            <ReportCard title="Atrasos" onCsv={() => downloadCsv('atrasos.csv', driversInRouteCsv(rows.filter((r) => r.status === 'delayed')))} onPdf={() => downloadPdf(delaysPdf(rows.filter((r) => r.status === 'delayed'), filterSummary, companyInfo), 'atrasos.pdf')} />
            <ReportCard title="Produtividade" onCsv={() => downloadCsv('produtividade.csv', driversInRouteCsv(rows))} onPdf={() => downloadPdf(productivityPdf(rows, filterSummary, companyInfo), 'produtividade.pdf')} />
          </div>
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

      {/* Create monitor */}
      <Dialog open={createDlg} onOpenChange={setCreateDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Monitoramento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Motorista</Label><Input value={createForm.driver_name} onChange={(e) => setCreateForm({ ...createForm, driver_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Placa</Label><Input value={createForm.plate} onChange={(e) => setCreateForm({ ...createForm, plate: e.target.value })} /></div>
              <div><Label>Total entregas</Label><Input type="number" value={createForm.total} onChange={(e) => setCreateForm({ ...createForm, total: Number(e.target.value) })} /></div>
              <div><Label>Prazo retorno (dias)</Label><Input type="number" value={createForm.deadline} onChange={(e) => setCreateForm({ ...createForm, deadline: Number(e.target.value) })} /></div>
            </div>
            <div><Label>Rota planejada</Label><Textarea value={createForm.planned_route} onChange={(e) => setCreateForm({ ...createForm, planned_route: e.target.value })} /></div>
            <div><Label>Observações</Label><Textarea value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDlg(false)}>Cancelar</Button>
            <Button onClick={async () => {
              if (!createForm.driver_name) { toast.error('Informe o motorista'); return; }
              const exp = createForm.deadline > 0
                ? new Date(Date.now() + createForm.deadline * 86400000).toISOString().slice(0, 10)
                : null;
              await createMut.mutateAsync({
                driver_name_snapshot: createForm.driver_name,
                vehicle_plate_snapshot: createForm.plate || null,
                total_deliveries: createForm.total,
                return_deadline_days: createForm.deadline || null,
                expected_return_date: exp,
                planned_route_text: createForm.planned_route,
                planned_cities: createForm.planned_route ? createForm.planned_route.split(/[,\n;/]/).map((s) => s.trim()).filter(Boolean) : [],
                notes: createForm.notes,
              });
              toast.success('Monitoramento criado');
              setCreateDlg(false);
              setCreateForm({ driver_name: '', plate: '', total: 0, deadline: 0, planned_route: '', notes: '' });
            }}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Progress update */}
      <Dialog open={!!progDlg} onOpenChange={(o) => !o && setProgDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar Entregas do Dia — {progDlg?.driver_name_snapshot}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Data</Label><Input type="date" value={progForm.date} onChange={(e) => setProgForm({ ...progForm, date: e.target.value })} /></div>
              <div><Label>Cidade</Label><Input value={progForm.city} onChange={(e) => setProgForm({ ...progForm, city: e.target.value })} /></div>
              <div><Label>Entregas na cidade</Label><Input type="number" value={progForm.qty} onChange={(e) => setProgForm({ ...progForm, qty: Number(e.target.value) })} /></div>
              <div><Label>Horário término</Label><Input type="time" value={progForm.finished_at} onChange={(e) => setProgForm({ ...progForm, finished_at: e.target.value })} /></div>
              <div><Label>Próxima cidade</Label><Input value={progForm.next_city} onChange={(e) => setProgForm({ ...progForm, next_city: e.target.value })} /></div>
              <div><Label>Entregas próxima</Label><Input type="number" value={progForm.next_qty} onChange={(e) => setProgForm({ ...progForm, next_qty: e.target.value })} /></div>
            </div>
            <div><Label>Observação</Label><Textarea value={progForm.observation} onChange={(e) => setProgForm({ ...progForm, observation: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setProgDlg(null)}>Cancelar</Button>
            <Button onClick={async () => {
              if (!progDlg) return;
              await progMut.mutateAsync({
                monitor_id: progDlg.id,
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
              setProgForm({ date: new Date().toISOString().slice(0, 10), city: '', qty: 0, next_city: '', next_qty: '', finished_at: '', observation: '' });
            }}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Forecast */}
      <Dialog open={!!forecastDlg} onOpenChange={(o) => !o && setForecastDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Atualizar Previsão de Chegada — {forecastDlg?.driver_name_snapshot}</DialogTitle></DialogHeader>
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
            <Button variant="ghost" onClick={() => setForecastDlg(null)}>Cancelar</Button>
            <Button onClick={async () => {
              if (!forecastDlg) return;
              await forecastMut.mutateAsync({
                monitor_id: forecastDlg.id, ...forecastForm,
              });
              toast.success('Previsão registrada');
              setForecastDlg(null);
            }}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Open monitor detail */}
      <Dialog open={!!openRow} onOpenChange={(o) => !o && setOpenRow(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{openRow?.monitor_number} — {openRow?.driver_name_snapshot}</DialogTitle></DialogHeader>
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
                    {openUpdates.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sem atualizações</TableCell></TableRow>}
                    {openUpdates.map((u) => (
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

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
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

function MonitorsTable({ rows, isLoading, onOpen, onProgress, onForecast, onUpdate, compact }: {
  rows: DriverMonitorRow[];
  isLoading: boolean;
  onOpen: (r: DriverMonitorRow) => void;
  onProgress: (r: DriverMonitorRow) => void;
  onForecast: (r: DriverMonitorRow) => void;
  onUpdate: ReturnType<typeof useUpdateMonitorStatus>;
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
            {isLoading && <TableRow><TableCell colSpan={12} className="text-center">Carregando…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground">Nenhum monitoramento encontrado</TableCell></TableRow>}
            {rows.map((r) => (
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
                    <Button size="sm" variant="outline" onClick={() => onProgress(r)}>Registrar</Button>
                    <Button size="sm" variant="outline" onClick={() => onForecast(r)}>Previsão</Button>
                    {r.status !== 'completed' && r.status !== 'cancelled' && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        await onUpdate.mutateAsync({ id: r.id, status: 'arrived', actual_returned_at: new Date().toISOString() });
                        toast.success('Chegada confirmada');
                      }}>Chegou</Button>
                    )}
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
