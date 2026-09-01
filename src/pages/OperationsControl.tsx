import { useEffect, useState } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { requireRouteResult } from '@/lib/controlTower/contracts';
import { useTenantCapabilities } from '@/hooks/useTenantCapabilities';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { calculateTripRoute } from '@/lib/controlTower/routeCalculation';


export default function OperationsControl() {
  const { toast } = useToast();
  const {currentTenant}=useTenant();
  const {user}=useAuth();
  const capability=useTenantCapabilities();
  const [evaluating,setEvaluating]=useState(false);
  const tripQuery = useActiveTripsLive();
  const alertQuery = useOpenTripAlerts();
  const { isLoading, dataUpdatedAt, refetch, isFetching } = tripQuery;
  const trips = tripQuery.isError ? [] : tripQuery.data ?? [];
  const alerts = alertQuery.isError ? [] : alertQuery.data ?? [];
  const tripCount = tripQuery.isPending || tripQuery.isError ? '—' : trips.length;
  const alertCount = alertQuery.isPending || alertQuery.isError ? '—' : alerts.length;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedTrip = trips.find(t => t.trip_id === selectedId) ?? null;
  const setSelectedTrip = (trip: ActiveTripLive | null) => setSelectedId(trip?.trip_id ?? null);
  const [now, setNow] = useState(Date.now());
  const [calculatingAll, setCalculatingAll] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const lastUpdateAge = dataUpdatedAt ? Math.round((now - dataUpdatedAt) / 1000) : null;

  const criticalCount = alerts.filter(a => a.severity === 'critical' || a.severity === 'danger').length;

  const goFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };
  const evaluateTracking=async()=>{
    if(!currentTenant || !capability.isEnabled('ssx') || capability.isError || evaluating)return;
    setEvaluating(true);
    try {
      requireRouteResult(await supabase.functions.invoke('update-trip-live-status',{body:{tenant_id:currentTenant.id}}));
      await Promise.all([refetch(),alertQuery.refetch()]);
      toast({title:'Rastreamento reavaliado',description:'Avaliação das posições já recebidas. Nenhuma consulta ao provedor SSX.'});
    }catch{toast({title:'Falha ao reavaliar rastreamento',description:'A atualização não foi confirmada.',variant:'destructive'});}
    finally{setEvaluating(false);}
  };

  const handleCalculateAll = async () => {
    if (trips.length === 0 || !user || !currentTenant || calculatingAll) return;
    setCalculatingAll(true);
    try {
      const results = await Promise.allSettled(trips.map(async t => {
        await calculateTripRoute(currentTenant.id,user.id,t.trip_id);
      }));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.length - ok;
      toast({
        title: fail ? 'Cálculo com falhas' : 'Rotas calculadas',
        description: `${ok} sucesso${fail > 0 ? `, ${fail} falha` : ''} via OSRM.`,
        variant: fail > 0 ? 'destructive' : 'default',
      });
      await refetch();
    } catch {
      toast({ title: 'Falha ao calcular rotas', description: 'Não foi possível confirmar o cálculo.', variant: 'destructive' });
    } finally {
      setCalculatingAll(false);
    }
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
            <p className="text-[10px] text-muted-foreground">Dados operacionais · posições somente com rastreamento habilitado e sinal recente</p>
          </div>
        </div>
        <div className="flex items-center gap-3 ml-auto text-xs">
          <Metric label="Viagens ativas" value={tripCount} />
          <Metric label="Alertas críticos" value={alertQuery.isPending || alertQuery.isError ? '—' : criticalCount} tone={criticalCount > 0 ? 'text-red-600' : ''} />
          <Metric label="Última consulta válida" value={!tripQuery.isError && lastUpdateAge != null ? `${lastUpdateAge}s atrás` : '—'} />
          <Button size="sm" variant="ghost" aria-label="Atualizar torre" onClick={() => { void refetch(); void alertQuery.refetch(); }} disabled={isFetching || alertQuery.isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching || alertQuery.isFetching ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Alternar tela cheia" onClick={goFullscreen}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>
      <div className="flex items-center gap-3 border-b p-2 text-xs">
        <p>{capability.isEnabled('ssx') && !capability.isError ? 'SSX habilitado. Consulta de dados não recalcula alertas automaticamente.' : 'SSX desativado ou indisponível. Nenhuma atualização de rastreamento será executada.'}</p>
        <Button size="sm" variant="outline" onClick={evaluateTracking} disabled={!capability.isEnabled('ssx') || capability.isError || evaluating}>
          {evaluating ? 'Reavaliando…' : 'Reavaliar rastreamento'}
        </Button>
      </div>
      {tripQuery.isError && <p role="alert" className="p-3 text-destructive">Não foi possível consultar as viagens. Dados anteriores ocultados; use Atualizar torre para tentar novamente.</p>}
      {alertQuery.isError && <p role="alert" className="p-3 text-destructive">Não foi possível consultar os alertas. Não é possível afirmar que não há alertas abertos.</p>}

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 border-r bg-card flex flex-col overflow-hidden">
          <div className="p-3 border-b">
            {tripQuery.isPending ? (
              <p role="status" className="py-2 text-center text-xs text-muted-foreground">Carregando indicadores…</p>
            ) : tripQuery.isError ? (
              <p className="py-2 text-center text-xs text-destructive">Indicadores indisponíveis.</p>
            ) : (
              <KpiCards trips={trips} />
            )}
          </div>

          <div className="p-3 border-b">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Alertas ({alertCount})
            </h3>
            {alertQuery.isPending ? (
              <p role="status" className="py-2 text-center text-xs text-muted-foreground">Carregando alertas…</p>
            ) : alertQuery.isError ? (
              <p className="py-2 text-center text-xs text-destructive">Alertas indisponíveis.</p>
            ) : (
              <AlertsPanel alerts={alerts} trips={trips} onSelectTrip={setSelectedTrip} />
            )}
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-3 pt-2 pb-1 flex items-center justify-between">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Viagens ({tripCount})
              </h3>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-2"
                onClick={handleCalculateAll}
                disabled={calculatingAll || trips.length === 0}
                title="Calcular rotas OSRM para todas as viagens"
              >
                <Route className={`h-3 w-3 mr-1 ${calculatingAll ? 'animate-spin' : ''}`} />
                {calculatingAll ? 'Calculando…' : 'Calcular todas'}
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="px-2 pb-3 space-y-1">
                {isLoading && (
                  <p role="status" className="text-xs text-muted-foreground text-center py-4">Carregando viagens…</p>
                )}
                {!isLoading && tripQuery.isError && (
                  <p className="text-xs text-destructive text-center py-4">Viagens indisponíveis.</p>
                )}
                {!isLoading && !tripQuery.isError && trips.length === 0 && (
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
        <main className="relative flex-1 p-3">
          <ControlTowerMap trips={trips} onSelectTrip={setSelectedTrip} />
          {tripQuery.isPending && (
            <div role="status" className="absolute inset-3 flex items-center justify-center rounded-lg bg-background/80 text-sm text-muted-foreground backdrop-blur-[1px]">
              Carregando mapa operacional…
            </div>
          )}
          {tripQuery.isError && (
            <div className="absolute inset-3 flex items-center justify-center rounded-lg bg-background/85 px-6 text-center text-sm text-destructive backdrop-blur-[1px]">
              Mapa indisponível porque as viagens não puderam ser confirmadas.
            </div>
          )}
        </main>
      </div>

      <TripDetailsDrawer
        key={selectedTrip?.trip_id ?? 'closed'}
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
