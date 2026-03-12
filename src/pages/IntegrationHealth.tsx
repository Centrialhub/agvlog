import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Activity, CheckCircle, XCircle, AlertTriangle, Clock, Truck, Radio, Database } from 'lucide-react';

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
}

export default function IntegrationHealth() {
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();

  const { data: tenant } = useQuery({
    queryKey: ['tenant_health_detail', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return null;
      const { data } = await supabase.from('tenants').select('settings').eq('id', currentTenant.id).single();
      return (data?.settings as any)?.pipeline_health || null;
    },
    enabled: !!currentTenant && isAdmin,
    refetchInterval: 30000,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['integration_accounts_health', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('integration_accounts')
        .select('id, username, status, last_login_at, last_error, settings, token_expires_at, hashauth')
        .eq('tenant_id', currentTenant.id);
      return data || [];
    },
    enabled: !!currentTenant && isAdmin,
  });

  const { data: positionStats } = useQuery({
    queryKey: ['position_freshness', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return null;
      const { data: positions } = await supabase
        .from('positions_last').select('vehicle_id, captured_at')
        .eq('tenant_id', currentTenant.id);
      if (!positions) return { total: 0, fresh: 0, stale: 0, offline: 0 };
      const now = Date.now();
      let fresh = 0, offline = 0, stale = 0;
      for (const p of positions) {
        const age = now - new Date(p.captured_at).getTime();
        if (age < 10 * 60 * 1000) fresh++;
        else if (age < 30 * 60 * 1000) offline++;
        else stale++;
      }
      return { total: positions.length, fresh, offline, stale };
    },
    enabled: !!currentTenant && isAdmin,
    refetchInterval: 30000,
  });

  const { data: mappingConflicts = [] } = useQuery({
    queryKey: ['mapping_conflicts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data: logs } = await supabase
        .from('integration_logs')
        .select('metadata, created_at')
        .eq('tenant_id', currentTenant.id)
        .eq('action', 'ssx_sync_units')
        .eq('success', true)
        .order('created_at', { ascending: false })
        .limit(1);
      const latest = logs?.[0];
      if (!latest) return [];
      const meta = latest.metadata as any;
      return meta?.conflict_details || [];
    },
    enabled: !!currentTenant && isAdmin,
  });

  if (!isAdmin) {
    return <div className="p-6 text-muted-foreground">Acesso restrito a administradores.</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
        <Activity className="h-6 w-6 text-primary" />
        Saúde da Integração SSX
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

      {/* Position Freshness */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4" /> Frescor de Posições
          </CardTitle>
        </CardHeader>
        <CardContent>
          {positionStats ? (
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">{positionStats.total}</div>
                <div className="text-xs text-muted-foreground">Com posição</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-success">{positionStats.fresh}</div>
                <div className="text-xs text-muted-foreground">Online (&lt;10m)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-warning">{positionStats.offline}</div>
                <div className="text-xs text-muted-foreground">Offline (10-30m)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-destructive">{positionStats.stale}</div>
                <div className="text-xs text-muted-foreground">Stale (&gt;30m)</div>
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

      {/* Mapping Conflicts */}
      {mappingConflicts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Conflitos de Mapeamento ({mappingConflicts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mappingConflicts.map((c: any, i: number) => (
                <div key={i} className="text-xs p-2 rounded bg-destructive/5 border border-destructive/20">
                  <span className="font-medium">{c.unit_code}</span>: {c.reason}
                  {c.ssx_plate && <span> · Placa SSX: {c.ssx_plate}</span>}
                  {c.linked_vehicle_plate && <span> · Vinculado a: {c.linked_vehicle_plate}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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

function ReadinessGates({ tenant, positionStats, mappingConflicts, accounts }: {
  tenant: any;
  positionStats: any;
  mappingConflicts: any[];
  accounts?: any[];
}) {
  const hasHashAuth = accounts?.some((a: any) => a.settings && (a.settings as any)?.hashauth);
  const gates = [
    {
      label: 'HashAuth configurado para tracking',
      met: !accounts || accounts.length === 0 || accounts.some((a: any) => !!(a as any).hashauth),
    },
    {
      label: 'Pipeline automático rodando há 24h+',
      met: tenant?.last_successful_poll_at &&
        (Date.now() - new Date(tenant.last_successful_poll_at).getTime()) < 30 * 60 * 1000,
    },
    {
      label: 'Fleet-map atualizando automaticamente',
      met: positionStats?.fresh > 0,
    },
    {
      label: 'Baixa incidência de rate limit recente',
      met: !tenant?.last_rate_limit_at ||
        (Date.now() - new Date(tenant.last_rate_limit_at).getTime()) > 60 * 60 * 1000,
    },
    {
      label: 'Conflitos de mapeamento visíveis e controlados',
      met: mappingConflicts.length === 0,
    },
    {
      label: 'Maioria dos veículos ativos com posição coerente',
      met: positionStats && positionStats.total > 0 && positionStats.fresh / positionStats.total > 0.3,
    },
  ];

  const allMet = gates.every(g => g.met);

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
