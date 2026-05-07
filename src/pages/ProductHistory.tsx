import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Search, History, Package, Truck, FileText, MapPin, PackageOpen, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { cn } from '@/lib/utils';

interface TimelineEvent {
  at: string;
  kind: 'inbound' | 'pickup' | 'load' | 'stop' | 'event' | 'outbound';
  title: string;
  description?: string;
  responsible?: string;
  destination?: string;
  reference?: string;
  meta?: { quantity?: number; weight?: number; pallets?: number; value?: number };
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  try { return format(new Date(d), 'dd/MM/yyyy HH:mm', { locale: ptBR }); } catch { return d; }
}
function fmtDate(d?: string | null) {
  if (!d) return '—';
  try { return format(new Date(d + 'T12:00:00'), 'dd/MM/yyyy', { locale: ptBR }); } catch { return d; }
}

const KIND_META: Record<TimelineEvent['kind'], { label: string; icon: any; color: string }> = {
  inbound:  { label: 'Entrada (NF-e)',     icon: ArrowDownToLine, color: 'bg-blue-500' },
  pickup:   { label: 'Coleta',             icon: PackageOpen,    color: 'bg-amber-500' },
  load:     { label: 'Carga / Romaneio',   icon: Truck,          color: 'bg-violet-500' },
  stop:     { label: 'Parada',             icon: MapPin,         color: 'bg-emerald-500' },
  event:    { label: 'Evento operacional', icon: History,        color: 'bg-slate-500' },
  outbound: { label: 'Saída (CT-e)',       icon: ArrowUpFromLine, color: 'bg-primary' },
};

export default function ProductHistory() {
  const { currentTenant } = useTenant();
  const [product, setProduct] = useState('');
  const [productInput, setProductInput] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openCombo, setOpenCombo] = useState(false);
  const [searched, setSearched] = useState(false);

  // Autocomplete: distinct product descriptions
  const { data: suggestions = [] } = useQuery({
    queryKey: ['product-suggestions', currentTenant?.id, productInput],
    queryFn: async () => {
      if (!currentTenant || productInput.length < 2) return [];
      const { data } = await (supabase as any)
        .from('load_items')
        .select('item_description')
        .eq('tenant_id', currentTenant.id)
        .ilike('item_description', `%${productInput}%`)
        .limit(50);
      const seen = new Set<string>();
      const list: string[] = [];
      (data || []).forEach((r: any) => {
        const v = (r.item_description || '').trim();
        if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); list.push(v); }
      });
      return list.slice(0, 12);
    },
    enabled: !!currentTenant && productInput.length >= 2,
  });

  const { data: timeline = [], isFetching, refetch } = useQuery({
    queryKey: ['product-history', currentTenant?.id, product, from, to],
    queryFn: async (): Promise<TimelineEvent[]> => {
      if (!currentTenant || !product) return [];

      // 1) load_items matching product (with rich joins)
      let q = (supabase as any)
        .from('load_items')
        .select(`
          id, item_description, quantity, pallet_count, weight_kg, status, created_at,
          fiscal_document_id, load_id,
          fiscal_documents(invoice_number, issue_date, remitter, recipient, recipient_city, recipient_state, value, document_type, pickup_order_id),
          loads(load_number, status, destination, actual_load_at, scheduled_load_at, trip_id,
            drivers(name),
            vehicles(plate, nickname)
          )
        `)
        .eq('tenant_id', currentTenant.id)
        .ilike('item_description', product);
      const { data: items, error } = await q.limit(2000);
      if (error) throw error;

      const events: TimelineEvent[] = [];
      const tripIds = new Set<string>();
      const pickupIds = new Set<string>();
      const loadIds = new Set<string>();

      (items || []).forEach((r: any) => {
        const fd = r.fiscal_documents;
        const ld = r.loads;
        if (fd?.pickup_order_id) pickupIds.add(fd.pickup_order_id);
        if (ld?.trip_id) tripIds.add(ld.trip_id);
        if (r.load_id) loadIds.add(r.load_id);

        // Inbound NF
        if (fd && fd.document_type === 'inbound') {
          events.push({
            at: (fd.issue_date || r.created_at) + (fd.issue_date ? 'T08:00:00' : ''),
            kind: 'inbound',
            title: `NF ${fd.invoice_number || '—'} — ${fd.remitter || 'Fornecedor'}`,
            description: r.item_description,
            responsible: fd.remitter || undefined,
            destination: fd.recipient || undefined,
            reference: fd.invoice_number || undefined,
            meta: { quantity: r.quantity, weight: r.weight_kg, pallets: r.pallet_count, value: fd.value },
          });
        }

        // Outbound CT-e
        if (fd && fd.document_type === 'outbound') {
          events.push({
            at: (fd.issue_date || r.created_at) + (fd.issue_date ? 'T18:00:00' : ''),
            kind: 'outbound',
            title: `CT-e ${fd.invoice_number || '—'}`,
            description: r.item_description,
            destination: [fd.recipient, fd.recipient_city, fd.recipient_state].filter(Boolean).join(' • '),
            reference: fd.invoice_number || undefined,
            meta: { value: fd.value },
          });
        }

        // Load assignment
        if (ld) {
          const at = ld.actual_load_at || ld.scheduled_load_at || r.created_at;
          events.push({
            at,
            kind: 'load',
            title: `Carga ${ld.load_number} • ${ld.status}`,
            description: r.item_description,
            destination: ld.destination || undefined,
            responsible: [ld.drivers?.name, ld.vehicles?.plate].filter(Boolean).join(' • ') || undefined,
            reference: ld.load_number,
            meta: { quantity: r.quantity, weight: r.weight_kg, pallets: r.pallet_count },
          });
        }
      });

      // 2) Pickup orders details
      if (pickupIds.size > 0) {
        const { data: pickups } = await (supabase as any)
          .from('pickup_orders')
          .select('id, pickup_number, remitter_name, recipient_name, driver_name_snapshot, vehicle_plate_snapshot, pickup_at, status')
          .in('id', Array.from(pickupIds));
        (pickups || []).forEach((p: any) => {
          events.push({
            at: p.pickup_at,
            kind: 'pickup',
            title: `Coleta ${p.pickup_number} • ${p.status}`,
            description: p.remitter_name ? `Remetente: ${p.remitter_name}` : undefined,
            destination: p.recipient_name || undefined,
            responsible: [p.driver_name_snapshot, p.vehicle_plate_snapshot].filter(Boolean).join(' • ') || undefined,
            reference: p.pickup_number,
          });
        });
      }

      // 3) Trip stops + events (responsibles + dates)
      if (tripIds.size > 0) {
        const ids = Array.from(tripIds);
        const [{ data: stops }, { data: evts }] = await Promise.all([
          (supabase as any).from('dispatch_stops').select('dispatch_trip_id, stop_order, destination, planned_arrival_at, actual_arrival_at, actual_departure_at, status').in('dispatch_trip_id', ids),
          (supabase as any).from('dispatch_events').select('dispatch_trip_id, event_type, event_at, notes').in('dispatch_trip_id', ids),
        ]);
        (stops || []).forEach((s: any) => {
          const at = s.actual_arrival_at || s.planned_arrival_at;
          if (!at) return;
          events.push({
            at,
            kind: 'stop',
            title: `Parada ${s.stop_order} — ${s.status || 'planejada'}`,
            destination: s.destination || undefined,
            description: s.actual_departure_at ? `Saída: ${fmtDateTime(s.actual_departure_at)}` : undefined,
          });
        });
        (evts || []).forEach((e: any) => {
          events.push({
            at: e.event_at,
            kind: 'event',
            title: e.event_type,
            description: e.notes || undefined,
          });
        });
      }

      // Date filters
      const fromTs = from ? new Date(from + 'T00:00:00').getTime() : null;
      const toTs   = to   ? new Date(to   + 'T23:59:59').getTime() : null;
      const filtered = events.filter(ev => {
        if (!ev.at) return false;
        const t = new Date(ev.at).getTime();
        if (fromTs && t < fromTs) return false;
        if (toTs && t > toTs) return false;
        return true;
      });

      filtered.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      return filtered;
    },
    enabled: !!currentTenant && !!product && searched,
  });

  const summary = useMemo(() => {
    const byKind: Record<string, number> = {};
    timeline.forEach(e => { byKind[e.kind] = (byKind[e.kind] || 0) + 1; });
    const destinations = new Set(timeline.map(e => e.destination).filter(Boolean));
    const responsibles = new Set(timeline.map(e => e.responsible).filter(Boolean));
    return { total: timeline.length, byKind, destinations: destinations.size, responsibles: responsibles.size };
  }, [timeline]);

  const handleSearch = () => {
    setProduct(productInput.trim());
    setSearched(true);
    setTimeout(() => refetch(), 0);
  };

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="h-6 w-6 text-primary" /> Histórico do Produto
          </h1>
          <p className="text-sm text-muted-foreground">
            Selecione um item e o período para ver toda a trajetória: entrada, coleta, carga, paradas, eventos e saída.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Consulta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">Produto</Label>
                <Popover open={openCombo} onOpenChange={setOpenCombo}>
                  <PopoverTrigger asChild>
                    <div className="relative">
                      <Input
                        value={productInput}
                        onChange={(e) => { setProductInput(e.target.value); setOpenCombo(true); }}
                        placeholder="Digite o nome do produto..."
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                      />
                    </div>
                  </PopoverTrigger>
                  {suggestions.length > 0 && (
                    <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
                      <Command>
                        <CommandList>
                          <CommandEmpty>Nenhuma sugestão.</CommandEmpty>
                          <CommandGroup>
                            {suggestions.map(s => (
                              <CommandItem key={s} value={s} onSelect={() => { setProductInput(s); setOpenCombo(false); }}>
                                <Package className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                                <span className="truncate">{s}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  )}
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Período — De</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Período — Até</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={handleSearch} disabled={!productInput.trim() || isFetching}>
                <Search className="h-4 w-4 mr-2" /> {isFetching ? 'Buscando...' : 'Buscar histórico'}
              </Button>
              <Button variant="outline" onClick={() => { setProductInput(''); setProduct(''); setFrom(''); setTo(''); setSearched(false); }}>
                Limpar
              </Button>
            </div>
          </CardContent>
        </Card>

        {searched && product && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Eventos no período</div><div className="text-2xl font-semibold">{summary.total}</div></CardContent></Card>
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Destinos distintos</div><div className="text-2xl font-semibold">{summary.destinations}</div></CardContent></Card>
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Responsáveis</div><div className="text-2xl font-semibold">{summary.responsibles}</div></CardContent></Card>
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Cargas / NFs</div><div className="text-2xl font-semibold">{(summary.byKind.load || 0) + (summary.byKind.inbound || 0) + (summary.byKind.outbound || 0)}</div></CardContent></Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Linha do tempo — "{product}"
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isFetching ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">Carregando histórico...</div>
                ) : timeline.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">
                    Nenhum evento encontrado para este produto no período selecionado.
                  </div>
                ) : (
                  <ol className="relative border-l border-border ml-3 space-y-5">
                    {timeline.map((ev, idx) => {
                      const meta = KIND_META[ev.kind];
                      const Icon = meta.icon;
                      return (
                        <li key={idx} className="ml-6">
                          <span className={cn("absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full text-white", meta.color)}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div className="rounded-lg border bg-card p-3">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                              <span className="text-xs text-muted-foreground">{fmtDateTime(ev.at)}</span>
                              {ev.reference && <Badge variant="secondary" className="font-mono text-[10px]">{ev.reference}</Badge>}
                            </div>
                            <div className="text-sm font-medium">{ev.title}</div>
                            {ev.description && <div className="text-xs text-muted-foreground mt-0.5">{ev.description}</div>}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2 text-xs">
                              {ev.destination && (
                                <div><span className="text-muted-foreground">Destino:</span> <span className="font-medium">{ev.destination}</span></div>
                              )}
                              {ev.responsible && (
                                <div><span className="text-muted-foreground">Responsável:</span> <span className="font-medium">{ev.responsible}</span></div>
                              )}
                              {ev.meta && (ev.meta.quantity || ev.meta.weight || ev.meta.pallets || ev.meta.value) && (
                                <div className="text-muted-foreground">
                                  {ev.meta.quantity ? `Qtd ${Number(ev.meta.quantity).toLocaleString('pt-BR')} ` : ''}
                                  {ev.meta.weight ? `• ${Number(ev.meta.weight).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}kg ` : ''}
                                  {ev.meta.pallets ? `• ${ev.meta.pallets} pal ` : ''}
                                  {ev.meta.value ? `• R$ ${Number(ev.meta.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}