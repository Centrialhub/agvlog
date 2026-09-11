import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { useTenantCapabilities } from '@/hooks/useTenantCapabilities';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Activity, CheckCircle, XCircle, AlertTriangle, Clock, Truck, Radio, Database } from 'lucide-react';
import { summarizeTelemetryFreshness } from '@/lib/telemetryFreshness';
import { IntegrationUnavailable } from '@/components/integrations/IntegrationUnavailable';
import { useFleetPositions } from '@/hooks/usePositions';
import {useWorkspaceSsxAccounts} from '@/hooks/useWorkspaceSsxAccounts';
import {evaluateSsxReadiness} from '@/lib/ssxReadiness';
import { parseTrackingObservability } from '@/lib/trackingObservability';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { SsxMappingConflictReview, type SsxMappingConflict } from '@/components/integrations/SsxMappingConflictReview';

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
}

export default function IntegrationHealth() {
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const { isEnabled, isLoading: capabilitiesLoading, error: capabilitiesError, refetch: refetchCapabilities } = useTenantCapabilities();
  const ssxEnabled = isEnabled('ssx');
  const positionsQuery = useFleetPositions(isAdmin && ssxEnabled);
  const queryClient = useQueryClient();
  const toast = useSonnerToast();

  const { data: tenant } = useQuery({
    queryKey: ['tenant_health_detail', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return null;
      const { data } = await supabase.from('tenants').select('settings').eq('id', currentTenant.id).single();
      return (data?.settings as any)?.pipeline_health || null;
    },
    enabled: !!currentTenant && isAdmin && ssxEnabled,
    refetchInterval: 30000,
  });

  const {data:accounts=[],isLoading:accountsLoading}=useWorkspaceSsxAccounts(!!currentTenant&&isAdmin&&ssxEnabled);

  const observabilityQuery = useQuery({
    queryKey: ['tracking-observability', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return null;
      const { data, error } = await supabase.rpc('get_tracking_observability_v1' as never, {
        _tenant_id: currentTenant.id,
      } as never);
      if (error) throw error;
      return parseTrackingObservability(data);
    },
    enabled: Boolean(currentTenant && isAdmin && ssxEnabled),
    refetchInterval: 30000,
  });

  const scheduleMutation = useMutation({
    mutationFn: async (schedule: { enabled: boolean; pollMinutes: number; fullSyncHours: number }) => {
      if (!currentTenant) throw new Error('Empresa não selecionada.');
      const { error } = await supabase.rpc('update_tracking_schedule_v1' as never, { _payload: {
        tenant_id: currentTenant.id,
        enabled: schedule.enabled,
        poll_interval_minutes: schedule.pollMinutes,
        full_sync_interval_hours: schedule.fullSyncHours,
      } } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success('Agendamento SSX atualizado.');
      await queryClient.invalidateQueries({ queryKey: ['tracking-observability', currentTenant?.id] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Falha ao atualizar agendamento.'),
  });

  const activeVehiclesQuery = useQuery({
    queryKey: ['active_vehicles_for_position_freshness', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('vehicles')
        .select('id')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('id')
        .limit(5_000);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant && isAdmin && ssxEnabled,
  });
  const positionStats = useMemo(() => {
    if (positionsQuery.error || activeVehiclesQuery.error || positionsQuery.isLoading || activeVehiclesQuery.isLoading) {
      return null;
    }
    const timestampByVehicle = new Map(
      (positionsQuery.data || []).map((position) => [position.vehicle_id, position.captured_at]),
    );
    return summarizeTelemetryFreshness(
      (activeVehiclesQuery.data || []).map((vehicle) => timestampByVehicle.get(vehicle.id) ?? null),
    );
  }, [
    activeVehiclesQuery.data,
    activeVehiclesQuery.error,
    activeVehiclesQuery.isLoading,
    positionsQuery.data,
    positionsQuery.error,
    positionsQuery.isLoading,
  ]);
  const positionStatsError = positionsQuery.error || activeVehiclesQuery.error;

  const { data: mappingConflicts = [] } = useQuery<SsxMappingConflict[]>({
    queryKey: ['ssx_mapping_conflicts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('list_ssx_mapping_conflicts_v1' as never, {
        _tenant_id: currentTenant.id,
        _status: 'open',
        _limit: 200,
        _offset: 0,
      } as never);
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as SsxMappingConflict[];
    },
    enabled: !!currentTenant && isAdmin && ssxEnabled,
  });

  if (!isAdmin) {
    return <div className="p-6 text-muted-foreground">Acesso restrito a administradores.</div>;
  }
  if (capabilitiesError) {
    return <IntegrationUnavailable capability="ssx" degraded onRetry={() => { void refetchCapabilities(); }} />;
  }
  if (!capabilitiesLoading && !ssxEnabled) {
    return (
      <IntegrationUnavailable
        capability="ssx"
        actionHref="/settings?tab=integration"
        actionLabel="Atualizar credencial SSX"
      />
    );
  }

  const operationalStatus = accountsLoading
    ? 'loading'
    : accounts.length === 0
      ? 'not_configured'
      : accounts.every((account) => account.status === 'ok')
        ? 'healthy'
        : 'degraded';
  const observability = observabilityQuery.data;

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
        <Activity className="h-6 w-6 text-primary" />
        Saúde da Integração SSX
        <Badge variant={operationalStatus === 'healthy' ? 'default' : 'secondary'}>{operationalStatus}</Badge>
      </h1>

      {/* Pipeline Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4" /> Pipeline Automático
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tenant ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Último poll</p>
                <p className="font-medium">{formatTime(tenant.last_run_at)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Último poll com dados</p>
                <p className="font-medium">{formatTime(tenant.last_successful_poll_at)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Último rate limit</p>
                <p className="font-medium">{formatTime(tenant.last_rate_limit_at)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Último erro persist.</p>
                <p className="font-medium">{formatTime(tenant.last_persistence_failure_at)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Modo</p>
                <p className="font-medium">{tenant.last_run_mode || '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Inseridos (último)</p>
                <p className="font-medium">{tenant.last_run_inserted ?? '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Unidades (último)</p>
                <p className="font-medium">{tenant.last_run_polled ?? '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Erros (último)</p>
                <p className="font-medium">{tenant.last_run_errors ?? '—'}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum dado de pipeline ainda. Configure o cron para ativar.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Observabilidade operacional</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {observabilityQuery.error ? <p role="alert" className="text-sm text-destructive">Falha ao consultar métricas reais de tracking.</p> : null}
          {observability ? <>
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Links SSX ativos" value={observability.trackerLinks.active} alert={observability.trackerLinks.conflicts > 0} />
              <Metric label="Conflitos em viagens" value={observability.trackerLinks.conflicts} alert={observability.trackerLinks.conflicts > 0} />
              <Metric label="Geofences de frota" value={observability.geofences.fleet} />
              <Metric label="Geofences de entrega" value={observability.geofences.delivery} />
              <Metric label="Eventos em 24h" value={observability.geofences.events24h} />
              <Metric label="Fila tracking/erros" value={`${observability.queue.pending}/${observability.queue.errors}`} alert={observability.queue.errors > 0} />
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
              <span>Endereços: {observability.addresses.pending} pendentes, {observability.addresses.ambiguous} ambíguos, {observability.addresses.error} com erro.</span>
              <Button asChild size="sm" variant="outline"><Link to="/address-resolution">Abrir fila</Link></Button>
              <span className="ml-auto text-xs text-muted-foreground">Última geofence avaliada: {formatTime(observability.geofences.lastEvaluatedAt)}</span>
            </div>
          </> : <p className="text-sm text-muted-foreground">Carregando métricas...</p>}
        </CardContent>
      </Card>

      {observability ? <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Agendamento por empresa</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><p className="text-xs text-muted-foreground">Coleta de posições</p>
            <Select value={String(observability.schedule.pollMinutes)} disabled={scheduleMutation.isPending}
              onValueChange={(value) => scheduleMutation.mutate({ ...observability.schedule, pollMinutes: Number(value) })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>
                {[1,3,5,10,15].map((minutes) => <SelectItem key={minutes} value={String(minutes)}>A cada {minutes} min</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><p className="text-xs text-muted-foreground">Sincronização completa</p>
            <Select value={String(observability.schedule.fullSyncHours)} disabled={scheduleMutation.isPending}
              onValueChange={(value) => scheduleMutation.mutate({ ...observability.schedule, fullSyncHours: Number(value) })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>
                {[1,3,6,12,24].map((hours) => <SelectItem key={hours} value={String(hours)}>A cada {hours} h</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant={observability.schedule.enabled ? 'outline' : 'default'} disabled={scheduleMutation.isPending}
            onClick={() => scheduleMutation.mutate({ ...observability.schedule, enabled: !observability.schedule.enabled })}>
            {observability.schedule.enabled ? 'Pausar agenda' : 'Ativar agenda'}
          </Button>
          <div className="text-xs text-muted-foreground">Última execução: {formatTime(observability.schedule.lastFinishedAt)} · status {observability.schedule.lastStatus || '—'} · falhas consecutivas {observability.schedule.consecutiveFailures}</div>
        </CardContent>
      </Card> : null}

      {/* Position Freshness */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4" /> Frescor de Posições
          </CardTitle>
        </CardHeader>
        <CardContent>
          {positionStatsError ? (
            <div className="flex flex-wrap items-center justify-between gap-3" role="alert">
              <p className="text-sm text-destructive">Não foi possível calcular o frescor das posições.</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void positionsQuery.refetch();
                  void activeVehiclesQuery.refetch();
                }}
              >
                Tentar novamente
              </Button>
            </div>
          ) : positionStats ? (
            <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-5">
              <div>
                <div className="text-2xl font-bold">{positionStats.total}</div>
                <div className="text-xs text-muted-foreground">Veículos ativos</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-success">{positionStats.fresh}</div>
                <div className="text-xs text-muted-foreground">Fresco (≤10m)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-warning">{positionStats.stale}</div>
                <div className="text-xs text-muted-foreground">Atenção (10–25m)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-destructive">{positionStats.offline}</div>
                <div className="text-xs text-muted-foreground">Offline (&gt;25m)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-muted-foreground">{positionStats.unknown}</div>
                <div className="text-xs text-muted-foreground">Sem dados</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          )}
        </CardContent>
      </Card>

      {/* Accounts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" /> Contas de Integração
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {accounts.map(acc => {
            const settings = (acc.settings || {}) as any;
            return (
              <div key={acc.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
                <div>
                  <p className="font-medium text-sm">{acc.username}</p>
                  <p className="text-xs text-muted-foreground">
                    Login: {formatTime(acc.last_login_at)} · Token expira: {formatTime(acc.token_expires_at)}
                  </p>
                  {acc.last_error && (
                    <p className="text-xs text-destructive mt-1">{acc.last_error}</p>
                  )}
                  {settings.last_units_sync_at && (
                    <p className="text-xs text-muted-foreground">Sync de unidades: {formatTime(settings.last_units_sync_at)}</p>
                  )}
                </div>
                <Badge variant="outline" className={
                  acc.status === 'ok' ? 'bg-success/10 text-success' :
                  acc.status === 'degraded' ? 'bg-warning/10 text-warning' :
                  'bg-destructive/10 text-destructive'
                }>
                  {acc.status === 'ok' ? <CheckCircle className="h-3 w-3 mr-1" /> :
                   acc.status === 'degraded' ? <AlertTriangle className="h-3 w-3 mr-1" /> :
                   <XCircle className="h-3 w-3 mr-1" />}
                  {acc.status}
                </Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <SsxMappingConflictReview conflicts={mappingConflicts} />

      {/* Readiness Gates */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" /> Prontidão para Telemetria
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ReadinessGates tenant={tenant} positionStats={positionStats} mappingConflicts={mappingConflicts} accounts={accounts} />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, alert = false }: { label: string; value: number | string; alert?: boolean }) {
  return <div className={`rounded-md border p-3 ${alert ? 'border-destructive/40 bg-destructive/5' : ''}`}>
    <p className={`text-2xl font-bold ${alert ? 'text-destructive' : ''}`}>{value}</p>
    <p className="text-xs text-muted-foreground">{label}</p>
  </div>;
}

function ReadinessGates({ tenant, positionStats, mappingConflicts, accounts }: {
  tenant: any;
  positionStats: any;
  mappingConflicts: any[];
  accounts?: any[];
}) {
  const {gates,allMet}=evaluateSsxReadiness({accounts,health:tenant,positionStats,mappingConflicts});

  return (
    <div className="space-y-2">
      {gates.map((g, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          {g.met ? (
            <CheckCircle className="h-4 w-4 text-success" />
          ) : (
            <XCircle className="h-4 w-4 text-destructive" />
          )}
          <span className={g.met ? 'text-foreground' : 'text-muted-foreground'}>{g.label}</span>
        </div>
      ))}
      <div className="mt-3 pt-3 border-t border-border">
        <Badge variant={allMet ? 'default' : 'secondary'} className={allMet ? 'bg-success text-success-foreground' : ''}>
          {allMet ? '✓ Pronto para telemetria' : '✗ Ainda não pronto para telemetria'}
        </Badge>
      </div>
    </div>
  );
}
