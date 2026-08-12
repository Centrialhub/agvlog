import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, CheckCircle2, AlertTriangle, FileText, ChevronRight, Clock, MapPin } from 'lucide-react';


export type DriverEventView = {
  id: string;
  type: 'finalizador' | 'informativo';
  code: string;
  label: string;
  stopName: string;
  invoice?: string;
  receiver?: string;
  document?: string;
  observation?: string;
  occurredAt: string;
  hasPhoto?: boolean;
  hasSignature?: boolean;
};


// Event types that finalize a delivery (recusa/entregue/etc.) vs informativos.
const FINAL_EVENT_TYPES = new Set([
  'delivered', 'refused', 'returned', 'partial_delivery', 'damaged', 'missing_goods',
  'delivery_completed', 'delivery_failed',
]);

function mapRowToEvent(row: any): DriverEventView {
  const type: DriverEventView['type'] = FINAL_EVENT_TYPES.has(row.event_type) ? 'finalizador' : 'informativo';
  const details: any = row.report_details || {};
  return {
    id: row.id,
    type,
    code: (row.event_type || '').toUpperCase().slice(0, 4),
    label: details.label || row.event_type || 'Evento',
    stopName: details.stop_name || details.client_name || '—',
    invoice: details.invoice || details.nf || undefined,
    receiver: details.receiver_name || undefined,
    document: details.receiver_document || undefined,
    observation: row.description || undefined,
    occurredAt: row.created_at,
    hasPhoto: !!details.has_photo,
    hasSignature: !!details.has_signature,
  };
}

export default function DriverEvents() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'all' | 'finalizador' | 'informativo'>('all');
  const [demoActive, setDemoActive] = useState(false);
  const { data: driver } = useCurrentDriver();
  const { data: trip } = useActiveTrip(driver?.id);
  const qc = useQueryClient();

  const { data: realEvents = [] } = useQuery({
    queryKey: ['driver_events', driver?.id, trip?.id],
    queryFn: async () => {
      if (!driver?.id) return [] as DriverEventView[];
      let q = supabase
        .from('operational_events')
        .select('*')
        .eq('driver_id', driver.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (trip?.id) q = q.eq('dispatch_trip_id', trip.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map(mapRowToEvent);
    },
    enabled: !!driver?.id,
  });

  useEffect(() => {
    if (!driver?.id) return;
    const channel = supabase
      .channel(`driver_events_${driver.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'operational_events', filter: `driver_id=eq.${driver.id}` },
        () => qc.invalidateQueries({ queryKey: ['driver_events'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, qc]);

  const events: DriverEventView[] = realEvents;

  const filtered = useMemo(() => {
    let list = events;
    if (tab !== 'all') list = list.filter((e) => e.type === tab);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.stopName.toLowerCase().includes(q) ||
          e.invoice?.toLowerCase().includes(q) ||
          e.label.toLowerCase().includes(q),
      );
    }
    return list;
  }, [events, search, tab]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Eventos lançados</h1>
        <p className="text-sm text-muted-foreground">Histórico de eventos da viagem</p>
      </div>


      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por cliente, NF ou evento..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-10"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="all" className="text-xs">Todos ({events.length})</TabsTrigger>
          <TabsTrigger value="finalizador" className="text-xs">
            Finalizadores ({events.filter((e) => e.type === 'finalizador').length})
          </TabsTrigger>
          <TabsTrigger value="informativo" className="text-xs">
            Informativos ({events.filter((e) => e.type === 'informativo').length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">Nenhum evento encontrado</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ajuste a busca ou filtros para ver outros eventos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((evt) => {
            const isFinal = evt.type === 'finalizador';
            const Icon = isFinal ? CheckCircle2 : AlertTriangle;
            return (
              <Card
                key={evt.id}
                className="cursor-pointer hover:bg-accent/40 transition-colors active:bg-accent"
                onClick={() => navigate(`/driver/events/${evt.id}`)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
                      isFinal ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{evt.label}</span>
                      <Badge variant="outline" className="text-[10px] py-0 h-4">
                        {evt.code}
                      </Badge>
                      {evt.invoice && (
                        <Badge variant="secondary" className="text-[10px] py-0 h-4">
                          NF {evt.invoice}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{evt.stopName}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span>
                        {new Date(evt.occurredAt).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}