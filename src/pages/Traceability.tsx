import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertCircle, CheckCircle2, Download, ExternalLink, FileSearch, History, PackageCheck, Search, Truck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type SiatStatus = 'pending' | 'in_transit' | 'delivered';

type TraceDocument = {
  id: string;
  invoice_number: string | null;
  access_key: string | null;
  document_type: string;
  issue_date: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  product_summary: string | null;
  pallet_count: number | null;
  weight_kg: number | null;
  value: number | null;
  freight_value: number | null;
  status: string;
  load_id: string | null;
  client_id: string | null;
  remitter: string | null;
  order_id: string | null;
  client_load_number: string | null;
  clients?: { company_name: string | null } | null;
  orders?: { order_number: string | null; payment_plan: string | null } | null;
  loads?: {
    id: string;
    load_number: string;
    status: string;
    origin: string | null;
    destination: string | null;
    trip_id: string | null;
    vehicles?: { plate: string | null; nickname: string | null } | null;
    drivers?: { name: string | null } | null;
  } | null;
};

type OperationalEvent = {
  id: string;
  load_id: string | null;
  event_type: string;
  severity: string;
  description: string | null;
  resolved_at: string | null;
  created_at: string;
  drivers?: { name: string | null } | null;
};

type DispatchTrip = {
  id: string;
  load_id: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  planned_start_at: string | null;
  planned_end_at: string | null;
  status: string;
};

type DispatchStop = {
  id: string;
  dispatch_trip_id: string;
  destination: string | null;
  status: string;
  actual_arrival_at: string | null;
  actual_departure_at: string | null;
  planned_arrival_at: string | null;
  stop_order: number;
};

type TraceRow = {
  doc: TraceDocument;
  siatStatus: SiatStatus;
  events: OperationalEvent[];
  trip: DispatchTrip | null;
  stops: DispatchStop[];
};

const siatLabels: Record<SiatStatus | 'all', string> = {
  all: 'Todos',
  pending: 'Pendente',
  in_transit: 'Em trânsito',
  delivered: 'Entregue',
};

const loadStatusToSiat = (doc: TraceDocument): SiatStatus => {
  const loadStatus = doc.loads?.status;
  if (loadStatus === 'delivered' || doc.status === 'delivered') return 'delivered';
  if (['loaded', 'in_transit'].includes(loadStatus || '')) return 'in_transit';
  return 'pending';
};

const statusBadgeClass = (status: SiatStatus) => {
  if (status === 'delivered') return 'bg-success/10 text-success border-success/20';
  if (status === 'in_transit') return 'bg-info/10 text-info border-info/20';
  return 'bg-warning/10 text-warning border-warning/20';
};

const fmtDate = (value?: string | null) => {
  if (!value) return '—';
  try { return format(parseISO(value.length === 10 ? `${value}T12:00:00` : value), 'dd/MM/yyyy', { locale: ptBR }); }
  catch { return '—'; }
};

const fmtTime = (value?: string | null) => {
  if (!value) return '—';
  try { return format(parseISO(value), 'HH:mm'); }
  catch { return '—'; }
};

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Traceability() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    invoice: '', loadNumber: '', clientRef: '', client: '', supplier: '', plate: '', driver: '', start: '', end: '', deliveryStart: '', deliveryEnd: '', status: 'all', pod: 'all', canhoto: 'all', occurrence: '', payment: '',
  });
  const [selectedRow, setSelectedRow] = useState<TraceRow | null>(null);
  const [eventForm, setEventForm] = useState({ type: 'other', severity: 'medium', status: 'no_change', description: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['traceability', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return { docs: [], events: [], trips: [], stops: [] };
      const { data: docs, error: docsError } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, access_key, document_type, issue_date, recipient, remitter, recipient_city, recipient_state, product_summary, pallet_count, weight_kg, value, freight_value, status, load_id, client_id, order_id, client_load_number, clients(company_name), orders(order_number, payment_plan), loads(id, load_number, status, origin, destination, trip_id, vehicles(plate, nickname), drivers(name))')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (docsError) throw docsError;

      const loadIds = Array.from(new Set((docs || []).map((d: any) => d.load_id).filter(Boolean)));
      if (!loadIds.length) return { docs: (docs || []) as TraceDocument[], events: [], trips: [], stops: [] };

      const [{ data: events, error: eventsError }, { data: trips, error: tripsError }] = await Promise.all([
        (supabase as any).from('operational_events').select('id, load_id, event_type, severity, description, resolved_at, created_at, drivers(name)').eq('tenant_id', currentTenant.id).in('load_id', loadIds).order('created_at', { ascending: false }),
        supabase.from('dispatch_trips').select('id, load_id, actual_start_at, actual_end_at, planned_start_at, planned_end_at, status').eq('tenant_id', currentTenant.id).in('load_id', loadIds),
      ]);
      if (eventsError) throw eventsError;
      if (tripsError) throw tripsError;

      const tripIds = (trips || []).map((t: any) => t.id);
      const { data: stops, error: stopsError } = tripIds.length
        ? await supabase.from('dispatch_stops').select('id, dispatch_trip_id, destination, status, actual_arrival_at, actual_departure_at, planned_arrival_at, stop_order').eq('tenant_id', currentTenant.id).in('dispatch_trip_id', tripIds).order('stop_order')
        : { data: [], error: null };
      if (stopsError) throw stopsError;

      return {
        docs: (docs || []) as TraceDocument[],
        events: (events || []) as OperationalEvent[],
        trips: (trips || []) as DispatchTrip[],
        stops: (stops || []) as DispatchStop[],
      };
    },
    enabled: !!currentTenant,
  });

  const rows = useMemo<TraceRow[]>(() => {
    const events = data?.events || [];
    const trips = data?.trips || [];
    const stops = data?.stops || [];
    return (data?.docs || []).map(doc => {
      const trip = trips.find(t => t.load_id === doc.load_id || t.id === doc.loads?.trip_id) || null;
      return {
        doc,
        siatStatus: loadStatusToSiat(doc),
        events: events.filter(e => e.load_id === doc.load_id),
        trip,
        stops: trip ? stops.filter(s => s.dispatch_trip_id === trip.id) : [],
      };
    });
  }, [data]);

  const filteredRows = useMemo(() => {
    const q = (value: string | null | undefined, needle: string) => String(value || '').toLowerCase().includes(needle.toLowerCase());
    return rows.filter(row => {
      const doc = row.doc;
      if (filters.invoice && !q(doc.invoice_number, filters.invoice)) return false;
      if (filters.loadNumber && !q(doc.loads?.load_number, filters.loadNumber)) return false;
      if (filters.clientRef && !q(doc.client_load_number, filters.clientRef) && !q(doc.orders?.order_number, filters.clientRef)) return false;
      if (filters.supplier && !q(doc.remitter, filters.supplier)) return false;
      if (filters.payment && !q(doc.orders?.payment_plan, filters.payment)) return false;
      if (filters.client && !q(doc.clients?.company_name || doc.recipient, filters.client)) return false;
      if (filters.plate && !q(doc.loads?.vehicles?.plate, filters.plate)) return false;
      if (filters.driver && !q(doc.loads?.drivers?.name, filters.driver)) return false;
      if (filters.occurrence && !row.events.some(e => q(e.description || e.event_type, filters.occurrence))) return false;
      if (filters.status !== 'all' && row.siatStatus !== filters.status) return false;
      if (filters.pod !== 'all' && (filters.pod === 'yes') !== (row.siatStatus === 'delivered')) return false;
      if (filters.canhoto !== 'all' && (filters.canhoto === 'yes') !== (row.siatStatus === 'delivered')) return false;
      if (filters.start && (!doc.issue_date || doc.issue_date < filters.start)) return false;
      if (filters.end && (!doc.issue_date || doc.issue_date > filters.end)) return false;
      if (filters.deliveryStart || filters.deliveryEnd) {
        const arr = row.stops.at(-1)?.actual_arrival_at;
        const arrDate = arr ? arr.slice(0, 10) : '';
        if (filters.deliveryStart && (!arrDate || arrDate < filters.deliveryStart)) return false;
        if (filters.deliveryEnd && (!arrDate || arrDate > filters.deliveryEnd)) return false;
      }
      return true;
    });
  }, [filters, rows]);

  const counts = useMemo(() => ({
    total: filteredRows.length,
    pending: filteredRows.filter(r => r.siatStatus === 'pending').length,
    inTransit: filteredRows.filter(r => r.siatStatus === 'in_transit').length,
    delivered: filteredRows.filter(r => r.siatStatus === 'delivered').length,
  }), [filteredRows]);

  const registerEvent = useMutation({
    mutationFn: async () => {
      if (!currentTenant || !selectedRow) return;
      const loadId = selectedRow.doc.load_id;
      if (!eventForm.description.trim()) throw new Error('Informe a descrição da ocorrência');
      await (supabase as any).from('operational_events').insert({
        tenant_id: currentTenant.id,
        load_id: loadId,
        client_id: selectedRow.doc.client_id,
        event_type: eventForm.type,
        severity: eventForm.severity,
        description: eventForm.description,
        created_by: user?.id,
      });
      if (eventForm.status !== 'no_change') {
        if (loadId) await supabase.from('loads').update({ status: eventForm.status, updated_at: new Date().toISOString() } as any).eq('id', loadId).eq('tenant_id', currentTenant.id);
        if (!loadId) await supabase.from('fiscal_documents').update({ status: eventForm.status === 'delivered' ? 'confirmed' : 'pending', updated_at: new Date().toISOString() } as any).eq('id', selectedRow.doc.id).eq('tenant_id', currentTenant.id);
      }
    },
    onSuccess: () => {
      toast({ title: 'Rastreabilidade atualizada' });
      setEventForm({ type: 'other', severity: 'medium', status: 'no_change', description: '' });
      queryClient.invalidateQueries({ queryKey: ['traceability'] });
      queryClient.invalidateQueries({ queryKey: ['operational_events'] });
      queryClient.invalidateQueries({ queryKey: ['loads'] });
    },
    onError: (error: any) => toast({ title: 'Erro', description: error.message, variant: 'destructive' }),
  });

  const exportCsv = () => {
    const headers = [
      'Nº NF', 'Chave de Acesso', 'Tipo Documento', 'Status Documento', 'Data Emissão',
      'Nº Carga', 'Status Carga', 'Trip ID', 'Origem', 'Destino Carga',
      'Carga Cliente (NF-e)', 'Ref. Cliente (Pedido)', 'Forma Pgto',
      'Cliente', 'Fornecedor / Remetente',
      'Cidade Destino', 'UF Destino',
      'Placa', 'Veículo', 'Motorista',
      'Situação SIAT', 'POD', 'Canhoto',
      'Valor Nota (R$)', 'Valor Frete (R$)', 'Paletes', 'Peso (kg)',
      'Itens / Mercadoria',
      'Início Planejado', 'Início Real', 'Fim Planejado', 'Fim Real',
      'Total Paradas', 'Paradas Concluídas',
      '1ª Chegada Prevista', '1ª Chegada Real', '1ª Saída Real',
      'Última Chegada Prevista', 'Última Chegada Real', 'Última Saída Real',
      'Detalhe Paradas',
      'Total Ocorrências', 'Ocorrências Abertas',
      'Ocorrências (descrição)', 'Tipos Ocorrências', 'Severidades', 'Datas Ocorrências',
    ];
    const body = filteredRows.map(({ doc, siatStatus, events, trip, stops }) => {
      const firstStop = stops[0];
      const lastStop = stops.at(-1);
      const completedStops = stops.filter(s => s.actual_arrival_at).length;
      const openOccurrences = events.filter(e => !e.resolved_at).length;
      const stopsDetail = stops.map(s =>
        `#${s.stop_order} ${s.destination || 'Parada'} [${s.status}] prev:${fmtDate(s.planned_arrival_at)} ${fmtTime(s.planned_arrival_at)} chegada:${fmtDate(s.actual_arrival_at)} ${fmtTime(s.actual_arrival_at)} saida:${fmtTime(s.actual_departure_at)}`
      ).join(' || ');
      return [
        doc.invoice_number || '',
        doc.access_key || '',
        doc.document_type || '',
        doc.status || '',
        fmtDate(doc.issue_date),
        doc.loads?.load_number || '',
        doc.loads?.status || '',
        doc.loads?.trip_id || '',
        doc.loads?.origin || '',
        doc.loads?.destination || '',
        doc.client_load_number || '',
        doc.orders?.order_number || '',
        doc.orders?.payment_plan || '',
        doc.clients?.company_name || doc.recipient || '',
        doc.remitter || '',
        doc.recipient_city || '',
        doc.recipient_state || '',
        doc.loads?.vehicles?.plate || '',
        doc.loads?.vehicles?.nickname || '',
        doc.loads?.drivers?.name || '',
        siatLabels[siatStatus],
        siatStatus === 'delivered' ? 'Sim' : 'Não',
        siatStatus === 'delivered' ? 'Sim' : 'Não',
        doc.value ?? 0,
        doc.freight_value ?? 0,
        doc.pallet_count ?? 0,
        doc.weight_kg ?? 0,
        doc.product_summary || '',
        `${fmtDate(trip?.planned_start_at)} ${fmtTime(trip?.planned_start_at)}`.trim(),
        `${fmtDate(trip?.actual_start_at)} ${fmtTime(trip?.actual_start_at)}`.trim(),
        `${fmtDate(trip?.planned_end_at)} ${fmtTime(trip?.planned_end_at)}`.trim(),
        `${fmtDate(trip?.actual_end_at)} ${fmtTime(trip?.actual_end_at)}`.trim(),
        stops.length,
        completedStops,
        `${fmtDate(firstStop?.planned_arrival_at)} ${fmtTime(firstStop?.planned_arrival_at)}`.trim(),
        `${fmtDate(firstStop?.actual_arrival_at)} ${fmtTime(firstStop?.actual_arrival_at)}`.trim(),
        fmtTime(firstStop?.actual_departure_at),
        `${fmtDate(lastStop?.planned_arrival_at)} ${fmtTime(lastStop?.planned_arrival_at)}`.trim(),
        `${fmtDate(lastStop?.actual_arrival_at)} ${fmtTime(lastStop?.actual_arrival_at)}`.trim(),
        fmtTime(lastStop?.actual_departure_at),
        stopsDetail,
        events.length,
        openOccurrences,
        events.map(e => e.description || e.event_type).join(' | '),
        events.map(e => e.event_type).join(' | '),
        events.map(e => e.severity).join(' | '),
        events.map(e => `${fmtDate(e.created_at)} ${fmtTime(e.created_at)}${e.resolved_at ? ' (resolvida)' : ' (aberta)'}`).join(' | '),
      ];
    });
    const csv = [headers, ...body].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rastreabilidade-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><FileSearch className="h-6 w-6 text-primary" /> Rastreabilidade NF</h1>
          <p className="text-sm text-muted-foreground">Consulta operacional de NF, carga, entrega, POD e ocorrências. Nº de CT-e/ORT é gerado apenas após emissão fiscal.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!filteredRows.length}><Download className="mr-2 h-4 w-4" /> Exportar CSV</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total de registros</p><p className="text-xl font-semibold">{counts.total}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pendente</p><p className="text-xl font-semibold text-warning">{counts.pending}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Em trânsito</p><p className="text-xl font-semibold text-info">{counts.inTransit}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Entregue</p><p className="text-xl font-semibold text-success">{counts.delivered}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-6">
            <div><Label>Nº NF</Label><Input value={filters.invoice} onChange={e => setFilters(f => ({ ...f, invoice: e.target.value }))} /></div>
            <div><Label>Nº Carga (empresa)</Label><Input value={filters.loadNumber} onChange={e => setFilters(f => ({ ...f, loadNumber: e.target.value }))} /></div>
            <div><Label>Nº Ref. Cliente</Label><Input value={filters.clientRef} onChange={e => setFilters(f => ({ ...f, clientRef: e.target.value }))} placeholder="Carga do cliente" /></div>
            <div><Label>Cliente</Label><Input value={filters.client} onChange={e => setFilters(f => ({ ...f, client: e.target.value }))} /></div>
            <div><Label>Fornecedor / Remetente</Label><Input value={filters.supplier} onChange={e => setFilters(f => ({ ...f, supplier: e.target.value }))} /></div>
            <div><Label>Forma de pagamento</Label><Input value={filters.payment} onChange={e => setFilters(f => ({ ...f, payment: e.target.value }))} placeholder="Ex: CIF, FOB, à vista" /></div>
            <div><Label>Placa</Label><Input value={filters.plate} onChange={e => setFilters(f => ({ ...f, plate: e.target.value }))} /></div>
            <div><Label>Motorista</Label><Input value={filters.driver} onChange={e => setFilters(f => ({ ...f, driver: e.target.value }))} /></div>
            <div><Label>Ocorrência</Label><Input value={filters.occurrence} onChange={e => setFilters(f => ({ ...f, occurrence: e.target.value }))} /></div>
          </div>
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            <div><Label>Emissão de</Label><Input type="date" value={filters.start} onChange={e => setFilters(f => ({ ...f, start: e.target.value }))} /></div>
            <div><Label>Emissão até</Label><Input type="date" value={filters.end} onChange={e => setFilters(f => ({ ...f, end: e.target.value }))} /></div>
            <div><Label>Entrega de</Label><Input type="date" value={filters.deliveryStart} onChange={e => setFilters(f => ({ ...f, deliveryStart: e.target.value }))} /></div>
            <div><Label>Entrega até</Label><Input type="date" value={filters.deliveryEnd} onChange={e => setFilters(f => ({ ...f, deliveryEnd: e.target.value }))} /></div>
            <div><Label>Situação</Label><Select value={filters.status} onValueChange={value => setFilters(f => ({ ...f, status: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(siatLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>POD</Label><Select value={filters.pod} onValueChange={value => setFilters(f => ({ ...f, pod: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="yes">Sim</SelectItem><SelectItem value="no">Não</SelectItem></SelectContent></Select></div>
            <div><Label>Canhoto</Label><Select value={filters.canhoto} onValueChange={value => setFilters(f => ({ ...f, canhoto: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="yes">Sim</SelectItem><SelectItem value="no">Não</SelectItem></SelectContent></Select></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead><TableHead>Palete</TableHead><TableHead>POD</TableHead><TableHead>Rec.Canhoto</TableHead><TableHead>Situação</TableHead><TableHead>Nº NF</TableHead><TableHead>Nº Carga</TableHead><TableHead>Ref. Cliente</TableHead><TableHead>Forma pgto</TableHead><TableHead>Valor Nota</TableHead><TableHead>Valor Frete</TableHead><TableHead>Cliente</TableHead><TableHead>Fornecedor</TableHead><TableHead>Placa</TableHead><TableHead>Motorista</TableHead><TableHead>Data Chegada</TableHead><TableHead>Hora Chegada</TableHead><TableHead>Ocorrência</TableHead><TableHead></TableHead>
                  </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? <TableRow><TableCell colSpan={18} className="py-10 text-center text-muted-foreground">Carregando rastreabilidade...</TableCell></TableRow>
                : filteredRows.length === 0 ? <TableRow><TableCell colSpan={18} className="py-10 text-center text-muted-foreground">Nenhum registro encontrado</TableCell></TableRow>
                : filteredRows.map(row => {
                  const lastStop = row.stops.at(-1);
                  return (
                    <TableRow key={row.doc.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedRow(row)}>
                      <TableCell><Search className="h-4 w-4 text-muted-foreground" /></TableCell>
                      <TableCell><Checkbox checked={(row.doc.pallet_count || 0) > 0} aria-label="Palete" /></TableCell>
                      <TableCell><Checkbox checked={row.siatStatus === 'delivered'} aria-label="POD" /></TableCell>
                      <TableCell><Checkbox checked={row.siatStatus === 'delivered'} aria-label="Canhoto" /></TableCell>
                      <TableCell><Badge variant="outline" className={statusBadgeClass(row.siatStatus)}>{siatLabels[row.siatStatus]}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{row.doc.invoice_number || '—'}</TableCell>
                      <TableCell className="font-mono text-xs text-primary">{row.doc.loads?.load_number || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.doc.orders?.order_number || '—'}</TableCell>
                      <TableCell className="text-xs">{row.doc.orders?.payment_plan || '—'}</TableCell>
                      <TableCell>{row.doc.value ? currency.format(Number(row.doc.value)) : '—'}</TableCell>
                      <TableCell>{row.doc.freight_value ? currency.format(Number(row.doc.freight_value)) : '—'}</TableCell>
                      <TableCell className="min-w-44">{row.doc.clients?.company_name || row.doc.recipient || '—'}</TableCell>
                      <TableCell className="min-w-40 text-xs">{row.doc.remitter || '—'}</TableCell>
                      <TableCell>{row.doc.loads?.vehicles?.plate || '—'}</TableCell>
                      <TableCell>{row.doc.loads?.drivers?.name || '—'}</TableCell>
                      <TableCell>{fmtDate(lastStop?.actual_arrival_at)}</TableCell>
                      <TableCell>{fmtTime(lastStop?.actual_arrival_at)}</TableCell>
                      <TableCell className="min-w-56">{row.events[0]?.description || row.events[0]?.event_type || '—'}</TableCell>
                      <TableCell>{row.doc.load_id && <Link to={`/loads/${row.doc.load_id}`} onClick={e => e.stopPropagation()}><ExternalLink className="h-4 w-4 text-primary" /></Link>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedRow} onOpenChange={open => !open && setSelectedRow(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>Detalhe da rastreabilidade</DialogTitle></DialogHeader>
          {selectedRow && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">NF</p><p className="font-semibold">{selectedRow.doc.invoice_number || '—'}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Nº Carga (empresa)</p><p className="font-semibold">{selectedRow.doc.loads?.load_number || '—'}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Ref. Cliente</p><p className="font-semibold">{selectedRow.doc.orders?.order_number || '—'}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Situação</p><Badge variant="outline" className={statusBadgeClass(selectedRow.siatStatus)}>{siatLabels[selectedRow.siatStatus]}</Badge></CardContent></Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 rounded-md border border-border p-4">
                  <h3 className="flex items-center gap-2 font-semibold"><PackageCheck className="h-4 w-4" /> Documento e mercadoria</h3>
                  <p className="text-sm"><span className="text-muted-foreground">Cliente:</span> {selectedRow.doc.clients?.company_name || selectedRow.doc.recipient || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Fornecedor / Remetente:</span> {selectedRow.doc.remitter || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Forma de pagamento:</span> {selectedRow.doc.orders?.payment_plan || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Valor da Nota:</span> {selectedRow.doc.value ? currency.format(Number(selectedRow.doc.value)) : '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Valor Frete:</span> {selectedRow.doc.freight_value ? currency.format(Number(selectedRow.doc.freight_value)) : '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Destino:</span> {[selectedRow.doc.recipient_city, selectedRow.doc.recipient_state].filter(Boolean).join(' - ') || selectedRow.doc.loads?.destination || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Itens:</span> {selectedRow.doc.product_summary || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Paletes/Peso:</span> {selectedRow.doc.pallet_count || 0} · {selectedRow.doc.weight_kg || 0} kg</p>
                </div>
                <div className="space-y-2 rounded-md border border-border p-4">
                  <h3 className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4" /> Transporte</h3>
                  <p className="text-sm"><span className="text-muted-foreground">Placa:</span> {selectedRow.doc.loads?.vehicles?.plate || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Motorista:</span> {selectedRow.doc.loads?.drivers?.name || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Início:</span> {fmtDate(selectedRow.trip?.actual_start_at || selectedRow.trip?.planned_start_at)} {fmtTime(selectedRow.trip?.actual_start_at || selectedRow.trip?.planned_start_at)}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Fim:</span> {fmtDate(selectedRow.trip?.actual_end_at || selectedRow.trip?.planned_end_at)} {fmtTime(selectedRow.trip?.actual_end_at || selectedRow.trip?.planned_end_at)}</p>
                </div>
              </div>

              <div className="rounded-md border border-border p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold"><History className="h-4 w-4" /> Histórico de paradas e ocorrências</h3>
                <div className="space-y-2">
                  {selectedRow.stops.map(stop => <div key={stop.id} className="flex items-center justify-between rounded-md bg-muted/40 p-2 text-sm"><span>{stop.stop_order}. {stop.destination || 'Parada'}</span><span className="text-muted-foreground">Chegada {fmtDate(stop.actual_arrival_at || stop.planned_arrival_at)} {fmtTime(stop.actual_arrival_at || stop.planned_arrival_at)} · Saída {fmtTime(stop.actual_departure_at)}</span></div>)}
                  {selectedRow.events.map(event => <div key={event.id} className="flex items-start gap-2 rounded-md bg-muted/40 p-2 text-sm"><AlertCircle className="mt-0.5 h-4 w-4 text-warning" /><div><p>{event.description || event.event_type}</p><p className="text-xs text-muted-foreground">{fmtDate(event.created_at)} {fmtTime(event.created_at)} · {event.resolved_at ? 'Resolvida' : 'Aberta'}</p></div></div>)}
                  {!selectedRow.stops.length && !selectedRow.events.length && <p className="text-sm text-muted-foreground">Sem histórico operacional registrado para este documento.</p>}
                </div>
              </div>

              <div className="rounded-md border border-border p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" /> Registrar ocorrência / atualizar situação</h3>
                <div className="grid gap-3 md:grid-cols-4">
                  <div><Label>Tipo</Label><Select value={eventForm.type} onValueChange={type => setEventForm(f => ({ ...f, type }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="other">Outro</SelectItem><SelectItem value="partial_delivery">Entrega parcial</SelectItem><SelectItem value="client_refused">Recusa</SelectItem><SelectItem value="damaged">Avaria</SelectItem><SelectItem value="wrong_address">Endereço errado</SelectItem></SelectContent></Select></div>
                  <div><Label>Severidade</Label><Select value={eventForm.severity} onValueChange={severity => setEventForm(f => ({ ...f, severity }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Baixa</SelectItem><SelectItem value="medium">Média</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="critical">Crítica</SelectItem></SelectContent></Select></div>
                  <div><Label>Nova situação</Label><Select value={eventForm.status} onValueChange={status => setEventForm(f => ({ ...f, status }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="no_change">Não alterar</SelectItem><SelectItem value="planned">Pendente</SelectItem><SelectItem value="in_transit">Em trânsito</SelectItem><SelectItem value="delivered">Entregue</SelectItem></SelectContent></Select></div>
                  <div className="flex items-end"><Button className="w-full" onClick={() => registerEvent.mutate()} disabled={registerEvent.isPending}>Registrar</Button></div>
                </div>
                <div className="mt-3"><Label>Descrição</Label><Textarea value={eventForm.description} onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))} placeholder="Ex.: Entrega realizada normalmente, canhoto recebido, divergência encontrada..." /></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
