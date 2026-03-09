import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Plus, Route, Trash2, Edit, MapPin } from 'lucide-react';

export default function Routes() {
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRoute, setEditRoute] = useState<any>(null);

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['route_templates', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('route_templates').select('*, geofences:corridor_geofence_id(name), start_poi:start_poi_id(name), end_poi:end_poi_id(name)')
        .eq('tenant_id', currentTenant.id).order('created_at', { ascending: false });
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['route_templates'] }); toast.success('Rota removida'); },
    onError: (e: any) => toast.error(e.message),
  });

  // Route runs stats
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
    const runs = routeRuns.filter((r: any) => r.route_id === routeId);
    const ok = runs.filter((r: any) => r.status === 'ok').length;
    const deviated = runs.filter((r: any) => r.status === 'deviated').length;
    return { total: runs.length, ok, deviated };
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Rotas</h1>
          <p className="text-sm text-muted-foreground">Controle de rotas por corredor geográfico</p>
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
          <p className="text-sm text-muted-foreground mt-1">Crie corredores via Geofences e vincule aqui</p>
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Corredor (Geofence)</TableHead>
                  <TableHead>POI Início</TableHead>
                  <TableHead>POI Fim</TableHead>
                  <TableHead>Limite Vel.</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>7 dias</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map((r: any) => {
                  const stats = getRouteStats(r.id);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-sm">{r.geofences?.name || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.start_poi?.name || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.end_poi?.name || '—'}</TableCell>
                      <TableCell>{r.route_speed_limit_kmh ? `${r.route_speed_limit_kmh} km/h` : '—'}</TableCell>
                      <TableCell className="text-xs">{Math.round((r.corridor_inside_ratio_threshold || 0.85) * 100)}%</TableCell>
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
                            <Button size="sm" variant="ghost" onClick={() => { if (confirm('Remover rota?')) deleteMutation.mutate(r.id); }}>
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

function RouteDialog({ open, onOpenChange, tenantId, geofences, pois, editRoute }: {
  open: boolean; onOpenChange: (v: boolean) => void; tenantId?: string;
  geofences: any[]; pois: any[]; editRoute: any;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [corridorId, setCorridorId] = useState('');
  const [startPoiId, setStartPoiId] = useState('');
  const [endPoiId, setEndPoiId] = useState('');
  const [threshold, setThreshold] = useState('85');
  const [outsideMin, setOutsideMin] = useState('5');
  const [speedLimit, setSpeedLimit] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  // Populate form when editing
  const handleOpen = () => {
    if (editRoute) {
      setName(editRoute.name || '');
      setCorridorId(editRoute.corridor_geofence_id || '');
      setStartPoiId(editRoute.start_poi_id || '');
      setEndPoiId(editRoute.end_poi_id || '');
      setThreshold(String(Math.round((editRoute.corridor_inside_ratio_threshold || 0.85) * 100)));
      setOutsideMin(String(editRoute.allowed_outside_minutes || 5));
      setSpeedLimit(editRoute.route_speed_limit_kmh ? String(editRoute.route_speed_limit_kmh) : '');
      setEnabled(editRoute.enabled ?? true);
    } else {
      setName(''); setCorridorId(''); setStartPoiId(''); setEndPoiId('');
      setThreshold('85'); setOutsideMin('5'); setSpeedLimit(''); setEnabled(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !name) return;
    setLoading(true);
    try {
      const payload = {
        tenant_id: tenantId,
        name,
        corridor_geofence_id: corridorId || null,
        start_poi_id: startPoiId || null,
        end_poi_id: endPoiId || null,
        corridor_inside_ratio_threshold: parseInt(threshold) / 100,
        allowed_outside_minutes: parseInt(outsideMin) || 5,
        route_speed_limit_kmh: speedLimit ? parseInt(speedLimit) : null,
        enabled,
      };

      if (editRoute) {
        const { error } = await supabase.from('route_templates').update(payload).eq('id', editRoute.id);
        if (error) throw error;
        toast.success('Rota atualizada');
      } else {
        const { error } = await supabase.from('route_templates').insert(payload);
        if (error) throw error;
        toast.success('Rota criada');
      }

      queryClient.invalidateQueries({ queryKey: ['route_templates'] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (v) handleOpen(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editRoute ? 'Editar Rota' : 'Nova Rota'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2"><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} required /></div>

          <div className="space-y-2">
            <Label>Corredor (Geofence)</Label>
            <Select value={corridorId} onValueChange={setCorridorId}>
              <SelectTrigger><SelectValue placeholder="Selecione um geofence" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Nenhum</SelectItem>
                {geofences.map((g: any) => (
                  <SelectItem key={g.id} value={g.id}>{g.name} ({g.category})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Crie o polígono do corredor na página Geofences (categoria: route_corridor)</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>POI Início (opcional)</Label>
              <Select value={startPoiId} onValueChange={setStartPoiId}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhum</SelectItem>
                  {pois.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name || `${p.category}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>POI Fim (opcional)</Label>
              <Select value={endPoiId} onValueChange={setEndPoiId}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhum</SelectItem>
                  {pois.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name || `${p.category}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Threshold (%)</Label>
              <Input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} min={50} max={100} />
            </div>
            <div className="space-y-2">
              <Label>Max fora (min)</Label>
              <Input type="number" value={outsideMin} onChange={e => setOutsideMin(e.target.value)} min={0} />
            </div>
            <div className="space-y-2">
              <Label>Vel. máx (km/h)</Label>
              <Input type="number" value={speedLimit} onChange={e => setSpeedLimit(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <Label>Ativa</Label>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
