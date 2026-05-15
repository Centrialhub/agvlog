import { useState, useMemo } from 'react';
import {
  useOperationalEvents, useCreateOperationalEvent, useUpdateOperationalEvent,
  EVENT_TYPES, EVENT_TYPE_LABELS, SEVERITY_LABELS, OperationalEvent,
} from '@/hooks/useOperationalEvents';
import { useLoads } from '@/hooks/useLoads';
import { useClients } from '@/hooks/useClients';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, AlertOctagon, CheckCircle, MessageSquare, Send, Truck, User, Building2, Package, Wifi, ListOrdered, X, CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { formatDistanceToNow, format, startOfMonth, subMonths, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useEffect, useRef } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useEventMessages, useSendEventMessage } from '@/hooks/useEventMessages';

const TYPE_COLORS: Record<string, string> = {
  missing_goods: '#ec4899',
  wrong_quantity: '#f59e0b',
  client_refused: '#ef4444',
  no_order: '#6366f1',
  expired_goods: '#8b5cf6',
  near_expiration: '#a855f7',
  damaged: '#0ea5e9',
  wrong_address: '#10b981',
  partial_delivery: '#14b8a6',
  return: '#f97316',
  other: '#64748b',
};

export default function OperationalEvents() {
  const { currentTenant } = useTenant();
  const { data: events = [], isLoading } = useOperationalEvents();
  const { data: loads = [] } = useLoads();
  const { data: clients = [] } = useClients();
  const createEvent = useCreateOperationalEvent();
  const updateEvent = useUpdateOperationalEvent();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [vehicleFilter, setVehicleFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<OperationalEvent | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('drivers').select('id, name').eq('tenant_id', currentTenant.id).eq('active', true).order('name');
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['events_vehicles', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('vehicles').select('id, plate').eq('tenant_id', currentTenant.id).eq('active', true).order('plate');
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // Realtime sync para sincronização ida/volta com app do motorista
  useEffect(() => {
    if (!currentTenant) return;
    const channel = supabase
      .channel('operational_events_live')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'operational_events', filter: `tenant_id=eq.${currentTenant.id}` },
        () => qc.invalidateQueries({ queryKey: ['operational_events'] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentTenant, qc]);

  const [form, setForm] = useState({
    event_type: 'missing_goods' as string,
    severity: 'medium',
    load_id: '',
    client_id: '',
    driver_id: '',
    description: '',
    financial_impact: 0,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const fromTs = dateFrom ? new Date(dateFrom.getFullYear(), dateFrom.getMonth(), dateFrom.getDate()).getTime() : null;
    const toTs = dateTo ? new Date(dateTo.getFullYear(), dateTo.getMonth(), dateTo.getDate(), 23, 59, 59, 999).getTime() : null;
    return events.filter(e => {
      if (q) {
        const hay = `${e.description || ''} ${e.loads?.load_number || ''} ${e.drivers?.name || ''} ${e.clients?.company_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter === 'open' && e.resolved_at) return false;
      if (statusFilter === 'resolved' && !e.resolved_at) return false;
      if (typeFilter !== 'all' && e.event_type !== typeFilter) return false;
      if (severityFilter !== 'all' && e.severity !== severityFilter) return false;
      if (vehicleFilter !== 'all' && e.vehicle_id !== vehicleFilter) return false;
      const ts = new Date(e.created_at).getTime();
      if (fromTs && ts < fromTs) return false;
      if (toTs && ts > toTs) return false;
      return true;
    });
  }, [events, search, statusFilter, typeFilter, severityFilter, vehicleFilter, dateFrom, dateTo]);

  const activeFiltersCount = (statusFilter !== 'open' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0) +
    (severityFilter !== 'all' ? 1 : 0) + (vehicleFilter !== 'all' ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (search ? 1 : 0);
  const clearAllFilters = () => {
    setSearch(''); setStatusFilter('open'); setTypeFilter('all'); setSeverityFilter('all');
    setVehicleFilter('all'); setDateFrom(undefined); setDateTo(undefined);
  };

  // ===== Chart data: últimos 12 meses, séries por tipo =====
  const { chartData, chartTypes, totals, totalCount } = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = startOfMonth(subMonths(now, i));
      months.push({ key: format(d, 'yyyy-MM'), label: format(d, 'MMM/yy', { locale: ptBR }) });
    }
    const cutoff = subMonths(now, 12);
    const recent = events.filter(e => isAfter(new Date(e.created_at), cutoff));
    const typeSet = new Set<string>();
    const totalsMap: Record<string, number> = {};
    recent.forEach(e => { typeSet.add(e.event_type); totalsMap[e.event_type] = (totalsMap[e.event_type] || 0) + 1; });
    const types = Array.from(typeSet);
    const data = months.map(m => {
      const row: any = { month: m.label };
      types.forEach(t => { row[t] = 0; });
      recent.forEach(e => {
        if (format(new Date(e.created_at), 'yyyy-MM') === m.key) row[e.event_type] = (row[e.event_type] || 0) + 1;
      });
      return row;
    });
    return { chartData: data, chartTypes: types, totals: totalsMap, totalCount: recent.length };
  }, [events]);

  const handleCreate = async () => {
    try {
      await createEvent.mutateAsync({
        ...form,
        load_id: form.load_id || null,
        client_id: form.client_id || null,
        driver_id: form.driver_id || null,
      } as any);
      toast({ title: 'Ocorrência registrada' });
      setDialogOpen(false);
      setForm({ event_type: 'missing_goods', severity: 'medium', load_id: '', client_id: '', driver_id: '', description: '', financial_impact: 0 });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const handleResolve = async (evt: OperationalEvent) => {
    try {
      await updateEvent.mutateAsync({ id: evt.id, resolved_at: new Date().toISOString(), resolution: 'Resolvido' } as any);
      toast({ title: 'Ocorrência resolvida' });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const severityColor = (s: string) => {
    if (s === 'critical') return 'bg-destructive/10 text-destructive';
    if (s === 'high') return 'bg-orange-500/10 text-orange-500';
    if (s === 'medium') return 'bg-warning/10 text-warning';
    return 'bg-muted text-muted-foreground';
  };

  const openCount = events.filter(e => !e.resolved_at).length;
  const criticalCount = events.filter(e => !e.resolved_at && (e.severity === 'high' || e.severity === 'critical')).length;
  const last24hCount = events.filter(e => Date.now() - new Date(e.created_at).getTime() < 24 * 3600 * 1000).length;
  const totalImpact = events.reduce((s, e) => s + (Number(e.financial_impact) || 0), 0);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertOctagon className="h-6 w-6 text-destructive" /> Ocorrências
            <Badge variant="outline" className="ml-2 gap-1 text-[10px] font-normal text-success border-success/30">
              <Wifi className="h-3 w-3" /> sincronizado
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">{openCount} abertas · {events.length} total · sincronia em tempo real com o app do motorista</p>
        </div>
        <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => document.getElementById('detalhamento-ocorrencias')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <ListOrdered className="h-4 w-4 mr-2" /> Ir para detalhamento
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Nova Ocorrência</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Registrar Ocorrência</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.event_type} onValueChange={v => setForm(f => ({ ...f, event_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{EVENT_TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Severidade</Label>
                  <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SEVERITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Carga</Label>
                  <Select value={form.load_id} onValueChange={v => setForm(f => ({ ...f, load_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{loads.map(l => <SelectItem key={l.id} value={l.id}>{l.load_number}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cliente</Label>
                  <Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Motorista</Label>
                  <Select value={form.driver_id} onValueChange={v => setForm(f => ({ ...f, driver_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{drivers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Descrição</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div><Label>Impacto Financeiro (R$)</Label><Input type="number" value={form.financial_impact} onChange={e => setForm(f => ({ ...f, financial_impact: parseFloat(e.target.value) || 0 }))} /></div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleCreate} disabled={createEvent.isPending}>Registrar</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Abertas" value={openCount} accent="bg-destructive/10 text-destructive" />
        <KpiCard label="Críticas / Altas" value={criticalCount} accent="bg-orange-500/10 text-orange-500" />
        <KpiCard label="Últimas 24h" value={last24hCount} accent="bg-primary/10 text-primary" />
        <KpiCard label="Impacto financeiro" value={`R$ ${totalImpact.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} accent="bg-warning/10 text-warning" />
      </div>

      {/* CHART em cima */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Total de Ocorrências</CardTitle>
              <CardDescription>Últimos 12 meses por tipo</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {chartTypes.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
              Sem dados nos últimos 12 meses
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any, name: any) => [v, EVENT_TYPE_LABELS[name as keyof typeof EVENT_TYPE_LABELS] || name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => EVENT_TYPE_LABELS[v as keyof typeof EVENT_TYPE_LABELS] || v} />
                  {chartTypes.map(t => (
                    <Line key={t} type="monotone" dataKey={t} stroke={TYPE_COLORS[t] || '#64748b'} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Type chips com totais (estilo TudoEntregue) */}
          {chartTypes.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setTypeFilter('all')}
                className={`text-xs rounded-full px-3 py-1.5 border transition-colors ${typeFilter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}
              >
                Total <span className="font-semibold ml-1">{totalCount}</span>
              </button>
              {chartTypes
                .sort((a, b) => (totals[b] || 0) - (totals[a] || 0))
                .map(t => {
                  const c = totals[t] || 0;
                  const pct = totalCount ? ((c / totalCount) * 100).toFixed(1) : '0';
                  const color = TYPE_COLORS[t] || '#64748b';
                  const active = typeFilter === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(active ? 'all' : t)}
                      className={`text-xs rounded-full pl-2 pr-3 py-1.5 border flex items-center gap-2 transition-all ${active ? 'border-foreground shadow-sm' : 'hover:bg-muted'}`}
                      style={{ borderColor: active ? color : undefined }}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                      <span>{EVENT_TYPE_LABELS[t as keyof typeof EVENT_TYPE_LABELS] || t}</span>
                      <span className="font-semibold">{c}</span>
                      <span className="text-muted-foreground">{pct}%</span>
                    </button>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filtros + Tabela detalhada */}
      <div id="detalhamento-ocorrencias" className="flex gap-2 items-center flex-wrap scroll-mt-4">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar (descrição, carga, motorista, cliente)..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="open">Abertas</SelectItem>
            <SelectItem value="resolved">Resolvidas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{EVENT_TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Severidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda severidade</SelectItem>
            {Object.entries(SEVERITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Veículo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os veículos</SelectItem>
            {vehicles.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn('h-9 justify-start text-left font-normal', !dateFrom && 'text-muted-foreground')}>
              <CalendarIcon className="h-4 w-4 mr-2" />
              {dateFrom ? format(dateFrom, 'dd/MM/yy') : 'De'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className={cn('p-3 pointer-events-auto')} />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn('h-9 justify-start text-left font-normal', !dateTo && 'text-muted-foreground')}>
              <CalendarIcon className="h-4 w-4 mr-2" />
              {dateTo ? format(dateTo, 'dd/MM/yy') : 'Até'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className={cn('p-3 pointer-events-auto')} />
          </PopoverContent>
        </Popover>
        {activeFiltersCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-9 text-muted-foreground">
            <X className="h-4 w-4 mr-1" /> Limpar ({activeFiltersCount})
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} resultado(s)</span>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalhamento das ocorrências</CardTitle>
          <CardDescription>Clique numa linha para abrir o detalhe e o chat com o motorista.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Severidade</TableHead>
                <TableHead>Carga</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Motorista</TableHead>
                <TableHead>Impacto</TableHead>
                <TableHead>Quando</TableHead>
                <TableHead className="w-28 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhuma ocorrência</TableCell></TableRow>
              ) : filtered.map(e => (
                <TableRow key={e.id} className={`cursor-pointer hover:bg-muted/50 ${e.resolved_at ? 'opacity-60' : ''}`} onClick={() => setSelectedEvent(e)}>
                  <TableCell className="text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_COLORS[e.event_type] || '#64748b' }} />
                      {EVENT_TYPE_LABELS[e.event_type as keyof typeof EVENT_TYPE_LABELS] || e.event_type}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className={severityColor(e.severity)}>{SEVERITY_LABELS[e.severity] || e.severity}</Badge></TableCell>
                  <TableCell className="text-sm">{e.loads?.load_number || '—'}</TableCell>
                  <TableCell className="text-sm">{e.clients?.company_name || '—'}</TableCell>
                  <TableCell className="text-sm">{e.drivers?.name || '—'}</TableCell>
                  <TableCell className="text-sm">{e.financial_impact ? `R$ ${e.financial_impact.toLocaleString('pt-BR')}` : '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: ptBR })}</TableCell>
                  <TableCell className="text-right" onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedEvent(e)} title="Abrir chat">
                        <MessageSquare className="h-4 w-4 text-primary" />
                      </Button>
                      {!e.resolved_at && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleResolve(e)} title="Resolver">
                          <CheckCircle className="h-4 w-4 text-success" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <EventDetailDrawer
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onResolve={handleResolve}
      />
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`mt-1 inline-flex items-center text-xl font-bold rounded-md px-2 py-0.5 ${accent}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function EventDetailDrawer({ event, onClose, onResolve }: { event: OperationalEvent | null; onClose: () => void; onResolve: (e: OperationalEvent) => void }) {
  const isOpen = !!event;
  return (
    <Sheet open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-0">
        {event && (
          <>
            <SheetHeader className="p-5 border-b">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SheetTitle className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS[event.event_type] || '#64748b' }} />
                    {EVENT_TYPE_LABELS[event.event_type as keyof typeof EVENT_TYPE_LABELS] || event.event_type}
                  </SheetTitle>
                  <SheetDescription>
                    {format(new Date(event.created_at), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}
                    {' · '}
                    {SEVERITY_LABELS[event.severity] || event.severity}
                  </SheetDescription>
                </div>
                {!event.resolved_at && (
                  <Button size="sm" variant="outline" onClick={() => onResolve(event)}>
                    <CheckCircle className="h-4 w-4 mr-1 text-success" /> Resolver
                  </Button>
                )}
              </div>
            </SheetHeader>

            <div className="p-5 space-y-3 border-b bg-muted/20">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow icon={<Package className="h-3.5 w-3.5" />} label="Carga" value={event.loads?.load_number || '—'} />
                <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Cliente" value={event.clients?.company_name || '—'} />
                <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Motorista" value={event.drivers?.name || '—'} />
                <InfoRow icon={<Truck className="h-3.5 w-3.5" />} label="Impacto" value={event.financial_impact ? `R$ ${Number(event.financial_impact).toLocaleString('pt-BR')}` : '—'} />
              </div>
              {event.description && (
                <div className="text-sm bg-background rounded-md border p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Descrição</div>
                  {event.description}
                </div>
              )}
              {event.resolution && (
                <div className="text-sm bg-success/5 border border-success/20 rounded-md p-3">
                  <div className="text-[10px] uppercase tracking-wide text-success mb-1">Resolução</div>
                  {event.resolution}
                </div>
              )}
            </div>

            <EventChat eventId={event.id} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm font-medium truncate">{value}</div>
      </div>
    </div>
  );
}

function EventChat({ eventId }: { eventId: string }) {
  const { data: messages = [], isLoading } = useEventMessages(eventId);
  const send = useSendEventMessage();
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    await send.mutateAsync({ eventId, message: v, role: 'operator' });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 py-2 border-b flex items-center gap-2 text-xs text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" /> Chat com o motorista (sincronia em tempo real)
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/10">
        {isLoading ? (
          <div className="text-center text-xs text-muted-foreground py-4">Carregando mensagens...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">Nenhuma mensagem ainda. Inicie a conversa com o motorista.</div>
        ) : (
          messages.map(m => {
            const fromDriver = m.sender_role === 'driver';
            return (
              <div key={m.id} className={`flex ${fromDriver ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${fromDriver ? 'bg-background border' : 'bg-primary text-primary-foreground'}`}>
                  <div className={`text-[10px] mb-0.5 opacity-70 ${fromDriver ? 'text-muted-foreground' : ''}`}>
                    {fromDriver ? `🚚 ${m.sender_name || 'Motorista'}` : (m.sender_name || 'Operação')}
                    {' · '}
                    {format(new Date(m.created_at), 'dd/MM HH:mm')}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.message}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="p-3 border-t bg-background flex gap-2">
        <Input
          placeholder="Escreva uma mensagem..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        />
        <Button onClick={handleSend} disabled={send.isPending || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
