import { confirmAction } from '@/hooks/useAlertStore';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';
import { Plus, Route, Trash2, Edit } from 'lucide-react';
import { RouteDialog } from '@/components/routes/RouteDialog';
import { getWaypointTypeConfig } from '@/lib/routes/waypoints';
import type { Tables } from '@/integrations/supabase/types';

type RouteTemplateView = Tables<'route_templates'> & { geofences: { name: string } | null };

export default function Routes() {
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRoute, setEditRoute] = useState<RouteTemplateView | null>(null);

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['route_templates', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('route_templates')
        .select('*, geofences:corridor_geofence_id(name)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const { data: allWaypoints = [] } = useQuery({
    queryKey: ['route_waypoints_all', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('route_waypoints')
        .select('route_id, waypoint_type, label, waypoint_order')
        .eq('tenant_id', currentTenant.id)
        .order('waypoint_order');
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const { data: geofences = [] } = useQuery({
    queryKey: ['geofences', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('geofences').select('id, name, category')
        .eq('tenant_id', currentTenant.id).eq('enabled', true);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const { data: pois = [] } = useQuery({
    queryKey: ['pois', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('pois').select('id, name, category')
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('route_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['route_templates'] });
      queryClient.invalidateQueries({ queryKey: ['route_waypoints_all'] });
      toast.success('Rota removida');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const { data: routeRuns = [] } = useQuery({
    queryKey: ['route_runs_recent', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('route_runs').select('route_id, status')
        .eq('tenant_id', currentTenant.id)
        .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const getRouteStats = (routeId: string) => {
    const runs = routeRuns.filter(run => run.route_id === routeId);
    const ok = runs.filter(run => run.status === 'ok').length;
    const deviated = runs.filter(run => run.status === 'deviated').length;
    return { total: runs.length, ok, deviated };
  };

  const getRouteWaypoints = (routeId: string) =>
    allWaypoints.filter(waypoint => waypoint.route_id === routeId);

  const renderWaypointSummary = (routeId: string) => {
    const wps = getRouteWaypoints(routeId);
    if (wps.length === 0) return <span className="text-muted-foreground">—</span>;

    const typeCounts: Record<string, number> = {};
    wps.forEach((w) => {
      typeCounts[w.waypoint_type] = (typeCounts[w.waypoint_type] || 0) + 1;
    });

    return (
      <div className="flex items-center gap-1 flex-wrap">
        {Object.entries(typeCounts).map(([type, count]) => {
          const config = getWaypointTypeConfig(type);
          const Icon = config.icon;
          return (
            <span key={type} className="inline-flex items-center gap-0.5" title={config.label}>
              <Icon className={`h-3 w-3 ${config.color}`} />
              {count > 1 && <span className="text-xs text-muted-foreground">{count}</span>}
            </span>
          );
        })}
        <span className="text-xs text-muted-foreground ml-1">({wps.length})</span>
      </div>
    );
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Rotas</h1>
          <p className="text-sm text-muted-foreground">Rotas com pontos estratégicos e corredores monitorados</p>
        </div>
        {isAdmin && (
          <Button onClick={() => { setEditRoute(null); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />Nova Rota
          </Button>
        )}
      </div>

      {isLoading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Carregando...</CardContent></Card>
      ) : routes.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center py-12">
          <Route className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="font-medium text-foreground">Nenhuma rota configurada</p>
          <p className="text-sm text-muted-foreground mt-1">Crie rotas com origem, destino e pontos estratégicos</p>
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Pontos</TableHead>
                  <TableHead>Corredor</TableHead>
                  <TableHead>Vel. máx</TableHead>
                  <TableHead>7 dias</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map((r) => {
                  const stats = getRouteStats(r.id);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>{renderWaypointSummary(r.id)}</TableCell>
                      <TableCell className="text-sm">{r.geofences?.name || '—'}</TableCell>
                      <TableCell className="text-sm">{r.route_speed_limit_kmh ? `${r.route_speed_limit_kmh} km/h` : '—'}</TableCell>
                      <TableCell className="text-xs">
                        {stats.total > 0 ? (
                          <span>{stats.ok} OK / <span className="text-destructive">{stats.deviated} desvio</span></span>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.enabled ? 'default' : 'secondary'} className="text-xs">
                          {r.enabled ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </TableCell>
                      <TableCell className="flex gap-1">
                        {isAdmin && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => { setEditRoute(r); setDialogOpen(true); }}>
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction('Remover rota?', { title: 'Remover rota', confirmLabel: 'Remover' })) deleteMutation.mutate(r.id); }}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <RouteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tenantId={currentTenant?.id}
        geofences={geofences}
        pois={pois}
        editRoute={editRoute}
      />
    </div>
  );
}
