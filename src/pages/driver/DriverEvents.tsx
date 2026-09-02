import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, CheckCircle2, AlertTriangle, FileText, ChevronRight, Clock, MapPin } from 'lucide-react';
import {
  mapOperationalEventToDriverEvent,
  type DriverEventView,
} from '@/lib/driver/driverEventView';
import { useDriverOperationalEventHistory } from '@/hooks/useDriverOperationalEventHistory';

export default function DriverEvents() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'all' | 'finalizador' | 'informativo'>('all');
  
  const {
    data: driver,
    isPending: driverLoading,
    error: driverError,
    refetch: refetchDriver,
  } = useCurrentDriver();
  const {
    data: trip,
    isPending: tripLoading,
    error: tripError,
    refetch: refetchTrip,
  } = useActiveTrip(driver?.id);
  const qc = useQueryClient();

  const {
    data: eventHistory,
    isPending: eventsLoading,
    error: eventsError,
    refetch: refetchEvents,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDriverOperationalEventHistory({
    driverId: driver?.id,
    tripId: trip?.id,
    enabled: !tripLoading && !tripError,
  });

  useEffect(() => {
    if (!driver?.id) return undefined;
    const channel = supabase
      .channel(`driver_events_${driver.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'operational_events', filter: `driver_id=eq.${driver.id}` },
        () => qc.invalidateQueries({ queryKey: ['driver_operational_event_history'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, qc]);

  const events: DriverEventView[] = (eventHistory?.items ?? []).map(mapOperationalEventToDriverEvent);
  const loading = driverLoading || (!!driver?.id && (tripLoading || eventsLoading));
  const readError = driverError || tripError || eventsError;

  const filtered = useMemo(() => {
    let list = events;
    if (tab !== 'all') list = list.filter((e) => e.type === tab);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.stopName.toLowerCase().includes(q) ||
          e.invoice?.toLowerCase().includes(q) ||
          e.label.toLowerCase().includes(q) ||
          e.observation?.toLowerCase().includes(q),
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

      {loading ? (
        <Card>
          <CardContent className="py-8 text-center" role="status">
            <p className="text-sm font-medium">Carregando eventos...</p>
          </CardContent>
        </Card>
      ) : readError ? (
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <p role="alert" className="text-sm font-medium">Não foi possível consultar os eventos.</p>
            <Button
              variant="outline"
              onClick={() => {
                if (driverError) void refetchDriver();
                if (tripError) void refetchTrip();
                if (eventsError) void refetchEvents();
              }}
            >
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>

      <div className="relative">
        <label htmlFor="driver-event-search" className="sr-only">Buscar eventos</label>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          id="driver-event-search"
          placeholder="Buscar por cliente, NF ou evento..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-10"
        />
      </div>

      <Tabs value={tab} onValueChange={(value) => {
        if (value === 'all' || value === 'finalizador' || value === 'informativo') setTab(value);
      }}>
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
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/driver/events/${evt.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/driver/events/${evt.id}`);
                  }
                }}
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
                      {evt.invoice && (
                        <Badge variant="secondary" className="text-[10px] py-0 h-4">
                          NF {evt.invoice}
                        </Badge>
                      )}
                    </div>
                    {evt.observation && (
                      <p className="text-xs text-foreground/80 mt-1 line-clamp-2">
                        {evt.observation}
                      </p>
                    )}
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
      {hasNextPage && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? 'Carregando mais eventos...' : 'Carregar mais eventos'}
        </Button>
      )}
        </>
      )}
    </div>
  );
}
