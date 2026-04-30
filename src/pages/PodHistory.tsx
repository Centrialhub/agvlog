import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, CheckCircle2, Clock, FileSearch, MapPin, PackageCheck, Truck, Hourglass, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

/**
 * Linha do tempo unificada de POD para uma NF.
 *
 * Une três fontes para reconstruir todo o ciclo de entrega:
 *  1. fiscal_documents.created_at  → "NF importada no sistema" (T0 do prazo de romaneio).
 *  2. dispatch_stops              → planejado x real de cada parada (chegada/saida).
 *  3. dispatch_events             → eventos discretos do motorista (foto, anexo, ocorrência, sign-off).
 *
 * Mostramos cada item em ordem cronológica para o operador entender exatamente
 * quando a NF saiu, encostou no destino, foi descarregada e o canhoto foi recebido.
 */

type Doc = {
  id: string;
  invoice_number: string | null;
  access_key: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  remitter: string | null;
  issue_date: string | null;
  created_at: string;
  load_id: string | null;
  status: string;
  loads?: {
    id: string;
    load_number: string;
    status: string;
    trip_id: string | null;
    vehicles?: { plate: string | null; nickname: string | null } | null;
    drivers?: { name: string | null } | null;
  } | null;
};

type Stop = {
  id: string;
  dispatch_trip_id: string;
  destination: string | null;
  status: string;
  stop_order: number;
  planned_arrival_at: string | null;
  actual_arrival_at: string | null;
  actual_departure_at: string | null;
};

type Trip = {
  id: string;
  status: string;
  planned_start_at: string | null;
  actual_start_at: string | null;
  planned_end_at: string | null;
  actual_end_at: string | null;
};

type DEvent = {
  id: string;
  dispatch_trip_id: string;
  dispatch_stop_id: string | null;
  event_type: string;
  event_at: string;
  notes: string | null;
  payload: any;
};

type TimelineItem = {
  at: string;
  kind: 'doc' | 'trip' | 'stop' | 'event';
  title: string;
  detail?: string;
  badge?: string;
  icon: 'doc' | 'truck' | 'pin' | 'check' | 'clock' | 'alert';
  status?: 'success' | 'warning' | 'info' | 'muted';
};

const fmt = (v?: string | null) => {
  if (!v) return '—';
  try { return format(parseISO(v), "dd/MM/yyyy HH:mm", { locale: ptBR }); } catch { return '—'; }
};

const eventTypeLabel = (t: string): string => {
  const map: Record<string, string> = {
    pod_signed: 'Canhoto assinado',
    pod_photo: 'Foto do canhoto',
    delivery_photo: 'Foto de entrega',
    delivery_proof: 'Comprovante de entrega',
    incident: 'Ocorrência registrada',
    arrival: 'Chegada confirmada',
    departure: 'Saída confirmada',
    shift_start: 'Início de jornada',
    shift_end: 'Fim de jornada',
    checklist: 'Checklist',
  };
  return map[t] || t.replace(/_/g, ' ');
};

const iconFor = (kind: TimelineItem['icon']) => {
  switch (kind) {
    case 'doc': return <FileSearch className="h-4 w-4" />;
    case 'truck': return <Truck className="h-4 w-4" />;
    case 'pin': return <MapPin className="h-4 w-4" />;
    case 'check': return <CheckCircle2 className="h-4 w-4" />;
    case 'alert': return <AlertCircle className="h-4 w-4" />;
    case 'clock':
    default: return <Clock className="h-4 w-4" />;
  }
};

const statusClasses = (s?: TimelineItem['status']) => {
  switch (s) {
    case 'success': return 'bg-success/10 text-success border-success/20';
    case 'warning': return 'bg-warning/10 text-warning border-warning/20';
    case 'info': return 'bg-info/10 text-info border-info/20';
    case 'muted':
    default: return 'bg-muted/40 text-muted-foreground border-border';
  }
};

export default function PodHistory() {
  const { docId } = useParams<{ docId: string }>();
  const { currentTenant } = useTenant();

  const { data, isLoading } = useQuery({
    queryKey: ['pod-history', currentTenant?.id, docId],
    enabled: !!currentTenant?.id && !!docId,
    queryFn: async () => {
      const { data: doc, error: docErr } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, access_key, recipient, recipient_city, recipient_state, remitter, issue_date, created_at, load_id, status, loads(id, load_number, status, trip_id, vehicles(plate, nickname), drivers(name))')
        .eq('tenant_id', currentTenant!.id)
        .eq('id', docId!)
        .maybeSingle();
      if (docErr) throw docErr;
      if (!doc) return { doc: null, trip: null, stops: [], events: [] };

      const tripId = (doc as any).loads?.trip_id || null;
      const loadId = (doc as any).load_id || null;

      let trip: Trip | null = null;
      if (loadId) {
        const { data: t } = await supabase
          .from('dispatch_trips')
          .select('id, status, planned_start_at, actual_start_at, planned_end_at, actual_end_at')
          .eq('tenant_id', currentTenant!.id)
          .eq('load_id', loadId)
          .maybeSingle();
        trip = (t as Trip) || null;
      }
      const finalTripId = trip?.id || tripId;

      let stops: Stop[] = [];
      let events: DEvent[] = [];
      if (finalTripId) {
        const [stopsRes, eventsRes] = await Promise.all([
          supabase.from('dispatch_stops')
            .select('id, dispatch_trip_id, destination, status, stop_order, planned_arrival_at, actual_arrival_at, actual_departure_at')
            .eq('tenant_id', currentTenant!.id)
            .eq('dispatch_trip_id', finalTripId)
            .order('stop_order'),
          supabase.from('dispatch_events')
            .select('id, dispatch_trip_id, dispatch_stop_id, event_type, event_at, notes, payload')
            .eq('tenant_id', currentTenant!.id)
            .eq('dispatch_trip_id', finalTripId)
            .order('event_at'),
        ]);
        if (stopsRes.error) throw stopsRes.error;
        if (eventsRes.error) throw eventsRes.error;
        stops = (stopsRes.data as Stop[]) || [];
        events = (eventsRes.data as DEvent[]) || [];
      }

      return { doc: doc as Doc, trip, stops, events };
    },
  });

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!data?.doc) return [];
    const items: TimelineItem[] = [];
    const { doc, trip, stops, events } = data;

    items.push({
      at: doc.created_at,
      kind: 'doc',
      title: 'NF importada no sistema',
      detail: 'Início da contagem do prazo de romaneio',
      icon: 'doc',
      status: 'info',
    });
    if (doc.issue_date) {
      items.push({
        at: doc.issue_date,
        kind: 'doc',
        title: 'Emissão da NF',
        icon: 'doc',
        status: 'muted',
      });
    }

    if (trip?.planned_start_at) {
      items.push({ at: trip.planned_start_at, kind: 'trip', title: 'Início planejado da viagem', icon: 'truck', status: 'muted' });
    }
    if (trip?.actual_start_at) {
      items.push({ at: trip.actual_start_at, kind: 'trip', title: 'Saída efetiva da viagem', icon: 'truck', status: 'info' });
    }

    const stopMap = new Map<string, Stop>();
    for (const s of stops) {
      stopMap.set(s.id, s);
      if (s.planned_arrival_at) {
        items.push({ at: s.planned_arrival_at, kind: 'stop', title: `Parada #${s.stop_order} prevista`, detail: s.destination || undefined, icon: 'pin', status: 'muted' });
      }
      if (s.actual_arrival_at) {
        items.push({ at: s.actual_arrival_at, kind: 'stop', title: `Parada #${s.stop_order} — chegada`, detail: s.destination || undefined, icon: 'pin', status: 'success' });
      }
      if (s.actual_departure_at) {
        items.push({ at: s.actual_departure_at, kind: 'stop', title: `Parada #${s.stop_order} — saída`, detail: s.destination || undefined, icon: 'pin', status: 'info' });
      }
    }

    for (const e of events) {
      const stop = e.dispatch_stop_id ? stopMap.get(e.dispatch_stop_id) : null;
      const isPod = /pod|delivery|canhoto|signed|photo/i.test(e.event_type);
      const isIncident = /incident|issue|fail/i.test(e.event_type);
      items.push({
        at: e.event_at,
        kind: 'event',
        title: eventTypeLabel(e.event_type),
        detail: [stop ? `Parada #${stop.stop_order} ${stop.destination || ''}`.trim() : null, e.notes].filter(Boolean).join(' · ') || undefined,
        badge: e.event_type,
        icon: isIncident ? 'alert' : isPod ? 'check' : 'clock',
        status: isIncident ? 'warning' : isPod ? 'success' : 'info',
      });
    }

    if (trip?.actual_end_at) {
      items.push({ at: trip.actual_end_at, kind: 'trip', title: 'Encerramento da viagem', icon: 'truck', status: 'success' });
    }

    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [data]);

  const lastStop = data?.stops?.at(-1);
  const delivered = data?.doc?.status === 'delivered' || data?.doc?.loads?.status === 'delivered' || !!lastStop?.actual_arrival_at;

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Link to="/traceability" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground mb-1">
              <ArrowLeft className="h-3 w-3 mr-1" /> Voltar à rastreabilidade
            </Link>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <PackageCheck className="h-6 w-6 text-primary" />
              Histórico do POD
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Linha do tempo completa do comprovante de entrega para a NF selecionada.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {delivered ? (
              <Badge variant="outline" className="bg-success/10 text-success border-success/20 gap-1">
                <CheckCircle2 className="h-3 w-3" /> Entregue
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 gap-1">
                <Hourglass className="h-3 w-3" /> Em andamento
              </Badge>
            )}
            {data?.doc?.load_id && (
              <Link to={`/loads/${data.doc.load_id}`}>
                <Button variant="outline" size="sm">Abrir carga</Button>
              </Link>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="p-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Nº NF</p>
              <p className="font-semibold">{data?.doc?.invoice_number || '—'}</p>
              <p className="font-mono text-[10px] text-muted-foreground break-all">{data?.doc?.access_key || ''}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cliente / destinatário</p>
              <p className="font-medium">{data?.doc?.recipient || '—'}</p>
              <p className="text-xs text-muted-foreground">{[data?.doc?.recipient_city, data?.doc?.recipient_state].filter(Boolean).join(' / ')}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Carga / motorista</p>
              <p className="font-medium">{data?.doc?.loads?.load_number || '—'}</p>
              <p className="text-xs text-muted-foreground">
                {data?.doc?.loads?.drivers?.name || 'Sem motorista'}
                {data?.doc?.loads?.vehicles?.plate ? ` · ${data.doc.loads.vehicles.plate}` : ''}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Importada em</p>
              <p className="font-medium">{fmt(data?.doc?.created_at)}</p>
              <p className="text-xs text-muted-foreground">Entrega: {fmt(lastStop?.actual_arrival_at)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Linha do tempo ({timeline.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
            ) : !data?.doc ? (
              <p className="text-sm text-muted-foreground py-6 text-center">NF não encontrada.</p>
            ) : timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nenhum evento registrado ainda. Eventos do POD aparecem aqui após a primeira parada/registro do motorista.
              </p>
            ) : (
              <ol className="relative border-l border-border ml-3 space-y-4">
                {timeline.map((it, i) => (
                  <li key={i} className="ml-4">
                    <span className={`absolute -left-[10px] flex h-5 w-5 items-center justify-center rounded-full border ${statusClasses(it.status)}`}>
                      {iconFor(it.icon)}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{it.title}</span>
                      {it.badge && (
                        <Badge variant="outline" className="text-[10px] font-mono">{it.badge}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{fmt(it.at)}</p>
                    {it.detail && <p className="text-xs text-muted-foreground mt-0.5">{it.detail}</p>}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {data?.stops && data.stops.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Resumo das paradas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.stops.map(s => (
                <div key={s.id} className="flex items-center justify-between border rounded p-2 text-sm">
                  <div>
                    <p className="font-medium">#{s.stop_order} {s.destination || 'Parada'}</p>
                    <p className="text-xs text-muted-foreground">Status: {s.status}</p>
                  </div>
                  <div className="text-right text-xs">
                    <div>Previsto: <span className="font-mono">{fmt(s.planned_arrival_at)}</span></div>
                    <div>Chegada: <span className="font-mono">{fmt(s.actual_arrival_at)}</span></div>
                    <div>Saída: <span className="font-mono">{fmt(s.actual_departure_at)}</span></div>
                  </div>
                </div>
              ))}
              <Separator />
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
