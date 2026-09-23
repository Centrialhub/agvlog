import { useScopedAlerts } from '@/hooks/useAlertStore';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { Plus, Route, Trash2, Edit } from 'lucide-react';
import { useListFilters } from '@/hooks/useListFilters';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { DataPagination } from '@/components/ui/data-pagination';
import { RouteDialog } from '@/components/routes/RouteDialog';
import { getWaypointTypeConfig } from '@/lib/routes/waypoints';
import type { Tables } from '@/integrations/supabase/types';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';

type RouteTemplateView = Tables<'route_templates'> & { geofences: { name: string } | null };

export default function Routes() {
  const { confirmAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const { filters, setFilter, resetFilters, activeCount } = useListFilters({ search: '', status: 'all', corridor: 'all' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRoute, setEditRoute] = useState<RouteTemplateView | null>(null);
  const [page,setPage]=useState(1);const pageSize=25;

  const routesQuery = useQuery({
    queryKey: ['route_templates', currentTenant?.id,filters.search,filters.status,filters.corridor,page],
    queryFn: async () => {
      if (!currentTenant) return {rows:[],total:0};
      const {data,error}=await supabase.rpc('list_operator_routes_page_v1' as never,{
        _tenant_id:currentTenant.id,_search:filters.search.trim()||null,_status:filters.status,
        _corridor:filters.corridor,_page:page,_page_limit:pageSize,
      } as never) as unknown as {data:{rows?:RouteTemplateView[];total?:number}|null;error:{message:string}|null};
      if(error)throw error;
      return {rows:data?.rows??[],total:Number(data?.total) || 0};
    },
    enabled: !!currentTenant,
  });
  const routes = routesQuery.data?.rows ?? [], isLoading = routesQuery.isLoading;
  const routeIds=routes.map(route=>route.id);

  const waypointsQuery = useQuery({
    queryKey: ['route_waypoints_all', currentTenant?.id,routeIds],
    queryFn: async () => {
      if (!currentTenant) return [];
      return fetchAllPostgrestPages<Pick<Tables<'route_waypoints'>, 'route_id' | 'waypoint_type' | 'label' | 'waypoint_order'>>(async (from,to) => {
        const {data,error}=await supabase.from('route_waypoints')
          .select('route_id, waypoint_type, label, waypoint_order')
          .eq('tenant_id',currentTenant.id).in('route_id',routeIds)
          .order('route_id').order('waypoint_order').order('id').range(from,to);
        return {data,error};
      },500);
    },
    enabled: !!currentTenant&&routeIds.length>0,
  });
  const allWaypoints = waypointsQuery.data ?? [];

  const geofencesQuery = useQuery({
    queryKey: ['geofences', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      return fetchAllPostgrestPages<Pick<Tables<'geofences'>, 'id' | 'name' | 'category'>>(async (from,to) => {
        const {data,error}=await supabase.from('geofences').select('id, name, category')
          .eq('tenant_id',currentTenant.id).eq('enabled',true).order('name').order('id').range(from,to);
        return {data,error};
      },200);
    },
    enabled: !!currentTenant&&dialogOpen,
  });
  const geofences = geofencesQuery.data ?? [];

  const poisQuery = useQuery({
    queryKey: ['pois', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      return fetchAllPostgrestPages<Pick<Tables<'pois'>, 'id' | 'name' | 'category'>>(async (from,to) => {
        const {data,error}=await supabase.from('pois').select('id, name, category')
          .eq('tenant_id',currentTenant.id).order('name').order('id').range(from,to);
        return {data,error};
      },200);
    },
    enabled: !!currentTenant&&dialogOpen,
  });
  const pois = poisQuery.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if(!currentTenant)throw new Error('Empresa não selecionada.');
      const { data, error } = await supabase.rpc('archive_route_template_v1' as never,{_tenant_id:currentTenant.id,_route_id:id} as never);
      if (error) throw error;
      return data as unknown as { archived: boolean; already_archived?: boolean };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['route_templates'] });
      queryClient.invalidateQueries({ queryKey: ['route_waypoints_all'] });
      if (result.archived) toast.success('Rota arquivada; o histórico foi preservado');
      else toast.info('A rota já estava arquivada');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const runsQuery = useQuery({
    queryKey: ['route_runs_recent', currentTenant?.id,routeIds],
    queryFn: async () => {
      if (!currentTenant) return [];
      return fetchAllPostgrestPages<Pick<Tables<'route_runs'>, 'route_id' | 'status'>>(async (from,to) => {
        const {data,error}=await supabase.from('route_runs').select('route_id, status')
          .eq('tenant_id', currentTenant.id)
          .in('route_id',routeIds).gte('created_at',new Date(Date.now()-7*86400000).toISOString())
          .order('created_at').order('id').range(from,to);
        return {data,error};
      },500);
    },
    enabled: !!currentTenant&&routeIds.length>0,
  });
  const routeRuns = runsQuery.data ?? [];
  const readQueries=[routesQuery,waypointsQuery,geofencesQuery,poisQuery,runsQuery];
  const readError=readQueries.find(query=>query.isError);

  const getRouteStats = (routeId: string) => {
    const runs = routeRuns.filter(run => run.route_id === routeId);
    const ok = runs.filter(run => run.status === 'ok').length;
    const deviated = runs.filter(run => run.status === 'deviated').length;
    return { total: runs.length, ok, deviated };
  };

  const getRouteWaypoints = (routeId: string) =>
    allWaypoints.filter(waypoint => waypoint.route_id === routeId);

  const filteredRoutes = routes;
  const total=routesQuery.data?.total??0;const pageCount=Math.max(1,Math.ceil(total/pageSize));
  useEffect(()=>{setPage(1);},[filters.search,filters.status,filters.corridor]);
  useEffect(()=>{if(page>pageCount)setPage(pageCount);},[page,pageCount]);

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
          <h1 className="text-2xl font-bold text-foreground">Corredores monitorados</h1>
          <p className="text-sm text-muted-foreground">Rotas com pontos estratégicos e corredores monitorados</p>
        </div>
        {isAdmin && (
          <Button onClick={() => { setEditRoute(null); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />Nova Rota
          </Button>
        )}
      </div>

      <ListFilterBar fields={[
        { key: 'search', label: 'Buscar corredor', type: 'search', value: filters.search, onChange: value => setFilter('search', value), placeholder: 'Nome, cerca ou ponto da rota' },
        { key: 'status', label: 'Situação', value: filters.status, onChange: value => setFilter('status', value), options: [{ value: 'all', label: 'Todas' }, { value: 'active', label: 'Ativos' }, { value: 'inactive', label: 'Inativos' }] },
        { key: 'corridor', label: 'Cerca vinculada', value: filters.corridor, onChange: value => setFilter('corridor', value), options: [{ value: 'all', label: 'Todos' }, { value: 'yes', label: 'Com cerca' }, { value: 'no', label: 'Sem cerca' }] },
      ]} onReset={()=>{setPage(1);resetFilters();}} activeCount={activeCount} resultCount={filteredRoutes.length} totalCount={total} loading={isLoading} />
      {readError&&<Card><CardContent className="py-4" role="alert">Não foi possível carregar todos os dados dos corredores. Listas incompletas não serão tratadas como vazias. <Button variant="outline" onClick={()=>void Promise.all(readQueries.filter(query=>query.isError).map(query=>query.refetch()))}>Tentar novamente</Button></CardContent></Card>}
      {isLoading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Carregando...</CardContent></Card>
      ) : readError ? null : filteredRoutes.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center py-12">
          <Route className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="font-medium text-foreground">Nenhum corredor encontrado</p>
          <p className="text-sm text-muted-foreground mt-1">Ajuste os filtros ou cadastre um corredor com seus pontos estratégicos</p>
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
                {filteredRoutes.map((r) => {
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
                            {r.enabled && (
                              <Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction('Arquivar rota e preservar todo o histórico?', { title: 'Arquivar rota', confirmLabel: 'Arquivar' })) deleteMutation.mutate(r.id); }}>
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            )}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataPagination page={page} pageCount={pageCount} totalCount={total} start={total?(page-1)*pageSize+1:0} end={Math.min(page*pageSize,total)} onPageChange={setPage}/>
          </CardContent>
        </Card>
      )}

      <RouteDialog
        open={dialogOpen&&!readError}
        onOpenChange={setDialogOpen}
        tenantId={currentTenant?.id}
        geofences={geofences}
        pois={pois}
        editRoute={editRoute}
      />
    </div>
  );
}
