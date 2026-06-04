import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Maximize2, Radio, RefreshCw, Route } from 'lucide-react';
import { useActiveTripsLive, useOpenTripAlerts } from '@/hooks/useActiveTripsLive';
import ControlTowerMap from '@/components/control-tower/ControlTowerMap';
import KpiCards from '@/components/control-tower/KpiCards';
import AlertsPanel from '@/components/control-tower/AlertsPanel';
import TripDetailsDrawer from '@/components/control-tower/TripDetailsDrawer';
import { STATE_COLORS, STATE_LABELS, type ActiveTripLive } from '@/lib/controlTower/types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';


export default function OperationsControl() {
  const { data: trips = [], isLoading, dataUpdatedAt, refetch, isFetching } = useActiveTripsLive();
  const { data: alerts = [] } = useOpenTripAlerts();
  const [selectedTrip, setSelectedTrip] = useState<ActiveTripLive | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const lastUpdateAge = dataUpdatedAt ? Math.round((now - dataUpdatedAt) / 1000) : null;

  const criticalCount = useMemo(
    () => alerts.filter((a) => a.severity === 'critical' || a.severity === 'danger').length,
    [alerts],
  );

  const goFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };

  return (
    <div className="-m-6 h-[calc(100vh-0px)] flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center gap-4 px-4 py-2 border-b bg-card">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Radio className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">Torre de Controle Operacional</h1>
            <p className="text-[10px] text-muted-foreground">Monitoramento em tempo real</p>
          </div>
        </div>
        <div className="flex items-center gap-3 ml-auto text-xs">
          <Metric label="Veículos ativos" value={trips.length} />
          <Metric label="Alertas críticos" value={criticalCount} tone={criticalCount > 0 ? 'text-red-600' : ''} />
          <Metric label="Última atualização" value={lastUpdateAge != null ? `${lastUpdateAge}s atrás` : '—'} />
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" variant="ghost" onClick={goFullscreen}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 border-r bg-card flex flex-col overflow-hidden">
          <div className="p-3 border-b">
            <KpiCards trips={trips} />
          </div>

          <div className="p-3 border-b">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Alertas ({alerts.length})
            </h3>
            <AlertsPanel alerts={alerts} trips={trips} onSelectTrip={setSelectedTrip} />
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground p-3 pb-1">
              Viagens ({trips.length})
            </h3>
            <ScrollArea className="flex-1">
              <div className="px-2 pb-3 space-y-1">
                {isLoading && (
                  <p className="text-xs text-muted-foreground text-center py-4">Carregando…</p>
                )}
                {!isLoading && trips.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">Nenhuma viagem ativa.</p>
                )}
                {trips.map((t) => (
                  <button
                    key={t.trip_id}
                    onClick={() => setSelectedTrip(t)}
                    className="w-full text-left rounded-md border px-2.5 py-2 hover:bg-accent/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{ background: STATE_COLORS[t.state] }} />
                      <span className="text-xs font-bold">{t.vehicle_plate ?? '—'}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] py-0 h-4">{STATE_LABELS[t.state]}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{t.driver_name ?? 'sem motorista'}</p>
                    {t.status_message && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{t.status_message}</p>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </aside>

        {/* Map */}
        <main className="flex-1 p-3">
          <ControlTowerMap trips={trips} onSelectTrip={setSelectedTrip} />
        </main>
      </div>

      <TripDetailsDrawer
        trip={selectedTrip}
        open={!!selectedTrip}
        onOpenChange={(v) => !v && setSelectedTrip(null)}
      />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card className="px-3 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${tone ?? ''}`}>{value}</p>
    </Card>
  );
}