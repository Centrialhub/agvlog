import { useScopedAlerts } from '@/hooks/useAlertStore';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isFreshPositionObservation } from '@/lib/positionTelemetry';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { useFleetPositions } from '@/hooks/usePositions';
import { useVehicles } from '@/hooks/useVehicles';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useListFilters } from '@/hooks/useListFilters';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { matchesSearch } from '@/lib/listFilters';
import { Separator } from '@/components/ui/separator';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import {
  Hexagon, Plus, Trash2, MapPin, Shield, Truck, Building2,
  Info, ArrowDownUp, Eye, EyeOff, HelpCircle, AlertTriangle, RefreshCw, Pencil, LockKeyhole
} from 'lucide-react';
import { MapContainer, TileLayer, Circle, CircleMarker, Popup } from 'react-leaflet';
import { GeofenceFormDialog, type EditableFleetGeofence } from '@/components/geofences/GeofenceFormDialog';
import 'leaflet/dist/leaflet.css';

const CATEGORIES = [
  { value: 'base', label: 'Base / Garagem', icon: Building2, color: '#22c55e', defaultRadius: 250, description: 'Sua base de operações, garagem ou pátio' },
  { value: 'client', label: 'Cliente', icon: MapPin, color: '#a855f7', defaultRadius: 300, description: 'Local de carga/descarga de um cliente' },
  { value: 'restricted', label: 'Zona Restrita', icon: Shield, color: '#ef4444', defaultRadius: 500, description: 'Área onde veículos não devem entrar' },
  { value: 'general', label: 'Outra', icon: Hexagon, color: '#3b82f6', defaultRadius: 300, description: 'Posto, pernoite, ponto de apoio, etc.' },
] as const;

const getCategoryConfig = (cat: string) => CATEGORIES.find(c => c.value === cat) || CATEGORIES[3];
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export default function Geofences() {
  const { confirmAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGeofence, setEditingGeofence] = useState<EditableFleetGeofence | null>(null);
  const { filters, setFilter, resetFilters, activeCount: filterCount } = useListFilters({ search: '', category: 'all', status: 'all' });
  const [showHelp, setShowHelp] = useState(false);

  const { data: geofences = [], isLoading } = useQuery({
    queryKey: ['geofences', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('geofences')
        .select('id, tenant_id, name, category, enabled, created_at, shape_kind, scope_kind, dispatch_stop_id, source_kind, source_address, center_lat, center_lng, radius_m, location_provider, location_accuracy_m, location_confidence, location_audit, enter_margin_m, exit_margin_m, transition_confirmations')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const { data: states = [] } = useQuery({
    queryKey: ['geofence_states', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('geofence_states')
        .select('*, vehicles(plate), geofences(name)')
        .eq('tenant_id', currentTenant.id)
        .eq('is_inside', true);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const { data: events = [] } = useQuery({
    queryKey: ['geofence_events', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('geofence_events')
        .select('*, vehicles(plate), geofences(name)')
        .eq('tenant_id', currentTenant.id)
        .order('event_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const positionsQuery = useFleetPositions();
  const vehiclesQuery = useVehicles();
  const plateByVehicle = new Map((vehiclesQuery.data || []).map((vehicle) => [vehicle.id, vehicle.plate]));
  const positions = (positionsQuery.error ? [] : (positionsQuery.data || []))
    .filter((position) => isFreshPositionObservation(position))
    .map((position) => ({
      ...position,
      plate: plateByVehicle.get(position.vehicle_id) || 'Veículo',
    }));

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.from('geofences').update({ enabled })
        .eq('id', id)
        .eq('tenant_id', currentTenant.id)
        .eq('scope_kind', 'fleet')
        .is('dispatch_stop_id', null)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Somente cercas de frota podem ser alteradas nesta tela.');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['geofences'] }); },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao atualizar geofence')),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.from('geofences').delete()
        .eq('id', id)
        .eq('tenant_id', currentTenant.id)
        .eq('scope_kind', 'fleet')
        .is('dispatch_stop_id', null)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Somente cercas de frota podem ser removidas nesta tela.');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['geofences'] }); toast.success('Geofence removida'); },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao remover geofence')),
  });

  const filtered = geofences.filter(row => matchesSearch(filters.search, row.name, getCategoryConfig(row.category || 'general').label) && (filters.category === 'all' || row.category === filters.category) && (filters.status === 'all' || row.enabled === (filters.status === 'active')));

  const activeCount = geofences.filter((g) => g.enabled).length;
  const freshVehicleIds = new Set(positions.map((position) => position.vehicle_id));
  const currentStates = states.filter((state) => freshVehicleIds.has(state.vehicle_id));
  const vehiclesInside = currentStates.length;

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Hexagon className="h-6 w-6 text-primary" />
            Cercas Virtuais (Geofences)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Áreas no mapa que monitoram automaticamente quando seus veículos entram ou saem
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setShowHelp(true)}>
            <HelpCircle className="h-4 w-4 mr-1" /> Como funciona
          </Button>
          {isAdmin && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Nova Cerca
            </Button>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold">{geofences.length}</div>
            <div className="text-xs text-muted-foreground">Cercas cadastradas</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-success">{activeCount}</div>
            <div className="text-xs text-muted-foreground">Ativas monitorando</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-primary">{positionsQuery.error ? '—' : vehiclesInside}</div>
            <div className="text-xs text-muted-foreground">Veículos dentro agora</div>
          </CardContent>
        </Card>
      </div>

      {positionsQuery.error && (
        <Card className="border-destructive/40 bg-destructive/5" role="alert">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Posições indisponíveis. O mapa e o total de veículos dentro das cercas foram ocultados.
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => void positionsQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty state with onboarding */}
      {geofences.length === 0 && !isLoading && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Hexagon className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Comece criando sua primeira cerca virtual</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                Uma cerca virtual é uma área no mapa (ex: sua garagem, o pátio de um cliente). 
                O sistema avisa automaticamente quando um veículo <strong>entra</strong> ou <strong>sai</strong> dessa área.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto text-left">
              {CATEGORIES.slice(0, 3).map(cat => {
                const Icon = cat.icon;
                return (
                  <div key={cat.value} className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
                    <Icon className="h-4 w-4 mt-0.5 shrink-0" style={{ color: cat.color }} />
                    <div>
                      <p className="text-xs font-medium">{cat.label}</p>
                      <p className="text-xs text-muted-foreground">{cat.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {isAdmin && (
              <Button onClick={() => setDialogOpen(true)} size="lg" className="mt-2">
                <Plus className="mr-2 h-4 w-4" /> Criar Primeira Cerca
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Map */}
      {(positions.length > 0 || geofences.some((f) => f.center_lat != null && f.center_lng != null)) && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="h-4 w-4" /> Mapa da Frota
            </CardTitle>
            <CardDescription>Posição atual dos veículos. Cercas ativas aparecem como áreas coloridas.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[350px]">
              <MapContainer
                center={positions.length > 0 ? [positions[0].lat, positions[0].lng] : [Number(geofences[0]?.center_lat) || -14.235, Number(geofences[0]?.center_lng) || -51.9253]}
                zoom={positions.length > 0 ? 10 : 14}
                className="h-full w-full z-0"
              >
                <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {geofences.flatMap((f) => f.enabled && f.center_lat != null && f.center_lng != null && f.radius_m != null ? [
                  <Circle key={f.id} center={[Number(f.center_lat), Number(f.center_lng)]} radius={Number(f.radius_m)}
                    pathOptions={{ color: getCategoryConfig(f.category || 'general').color, fillOpacity: 0.12 }}>
                    <Popup><strong>{f.name}</strong><br />Raio {Math.round(Number(f.radius_m))} m</Popup>
                  </Circle>,
                ] : [])}
                {positions.map((p) => (
                  <CircleMarker key={p.vehicle_id} center={[p.lat, p.lng]} radius={6}
                    pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.8 }}>
                    <Popup><strong>{p.plate}</strong></Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vehicles inside geofences right now */}
      {currentStates.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4 text-success" /> Veículos Dentro de Cercas Agora
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {currentStates.map((s, i) => (
                <Badge key={i} variant="outline" className="text-xs gap-1">
                  <Truck className="h-3 w-3" />
                  {s.vehicles?.plate || '—'}
                  <span className="text-muted-foreground">em</span>
                  {s.geofences?.name || '—'}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Geofences list + events */}
      {geofences.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Geofences list — takes 3 cols */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Suas Cercas ({geofences.length})</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <ListFilterBar fields={[
                { key: 'search', label: 'Buscar cerca', type: 'search', value: filters.search, onChange: value => setFilter('search', value), placeholder: 'Nome ou categoria' },
                { key: 'category', label: 'Categoria', value: filters.category, onChange: value => setFilter('category', value), options: [{ value: 'all', label: 'Todas as categorias' }, ...CATEGORIES] },
                { key: 'status', label: 'Monitoramento', value: filters.status, onChange: value => setFilter('status', value), options: [{ value: 'all', label: 'Todos' }, { value: 'active', label: 'Ativo' }, { value: 'inactive', label: 'Pausado' }] },
              ]} onReset={resetFilters} activeCount={filterCount} resultCount={filtered.length} totalCount={geofences.length} loading={isLoading} description="Filtros desta lista; mapa e eventos mostram a visão geral." />
              {filtered.map((g) => {
                const config = getCategoryConfig(g.category || 'general');
                const Icon = config.icon;
                const insideCount = currentStates.filter((s) => s.geofence_id === g.id).length;
                const deliveryReadOnly = g.scope_kind === 'delivery' || Boolean(g.dispatch_stop_id);

                return (
                  <div key={g.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: config.color + '20' }}>
                      <Icon className="h-4 w-4" style={{ color: config.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{g.name}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{config.label}</Badge>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {g.scope_kind === 'delivery' ? 'Entrega' : 'Frota'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {insideCount > 0 && (
                          <span className="text-xs text-success flex items-center gap-1">
                            <Truck className="h-3 w-3" /> {insideCount} dentro
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {g.enabled ? '● Monitorando' : '○ Pausada'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isAdmin && deliveryReadOnly && (
                        <Badge variant="outline" className="gap-1 text-[10px]" title="Gerada automaticamente pelo destino da parada">
                          <LockKeyhole className="h-3 w-3" /> Somente leitura
                        </Badge>
                      )}
                      {isAdmin && !deliveryReadOnly && (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => setEditingGeofence(g)} title={`Editar cerca ${g.name}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => toggleMutation.mutate({ id: g.id, enabled: !g.enabled })}
                            title={g.enabled ? 'Pausar monitoramento' : 'Ativar monitoramento'}
                          >
                            {g.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={async () => { if (await confirmAction(`Remover a cerca "${g.name}"?`, { title: 'Remover cerca', confirmLabel: 'Remover' })) deleteMutation.mutate(g.id); }}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Nenhuma cerca encontrada para os filtros
                </p>
              )}
            </CardContent>
          </Card>

          {/* Recent events — takes 2 cols */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ArrowDownUp className="h-4 w-4" /> Últimas Entradas e Saídas
              </CardTitle>
              <CardDescription>Eventos automáticos detectados pelo sistema</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {events.length === 0 ? (
                <div className="text-center py-8">
                  <ArrowDownUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Eventos aparecem quando veículos cruzam os limites das cercas
                  </p>
                </div>
              ) : events.map((ev) => (
                <div key={ev.id} className="flex items-center gap-2 p-2 rounded text-sm">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${ev.direction === 'enter' ? 'bg-success' : 'bg-warning'}`} />
                  <span className="font-medium text-xs">{ev.vehicles?.plate || '—'}</span>
                  <span className="text-xs text-muted-foreground">
                    {ev.direction === 'enter' ? 'entrou em' : 'saiu de'}
                  </span>
                  <span className="text-xs font-medium truncate">{ev.geofences?.name || '—'}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                    {new Date(ev.event_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Help dialog */}
      <HelpDialog open={showHelp} onOpenChange={setShowHelp} />

      {/* Create dialog */}
      {isAdmin && currentTenant && (
        <>
          <GeofenceFormDialog open={dialogOpen} onOpenChange={setDialogOpen} tenantId={currentTenant.id} />
          <GeofenceFormDialog open={Boolean(editingGeofence)}
            onOpenChange={(open) => { if (!open) setEditingGeofence(null); }}
            tenantId={currentTenant.id} geofence={editingGeofence} />
        </>
      )}
    </div>
  );
}
/* ─── Help Dialog ─── */
function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" /> O que são Cercas Virtuais?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p>
            Uma <strong>cerca virtual (geofence)</strong> é uma área geográfica que você define no mapa. 
            Quando um veículo da sua frota <strong>entra</strong> ou <strong>sai</strong> dessa área, 
            o sistema registra automaticamente o evento.
          </p>
          
          <Separator />
          
          <div>
            <p className="font-medium mb-2">Para que serve?</p>
            <ul className="space-y-2 text-muted-foreground">
              <li className="flex items-start gap-2">
                <Building2 className="h-4 w-4 mt-0.5 text-success shrink-0" />
                <span><strong className="text-foreground">Controle de base:</strong> Saiba quando veículos saem ou voltam para a garagem</span>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 text-purple-500 shrink-0" />
                <span><strong className="text-foreground">Entregas:</strong> Confirme automaticamente que o veículo chegou no cliente</span>
              </li>
              <li className="flex items-start gap-2">
                <Shield className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                <span><strong className="text-foreground">Zonas proibidas:</strong> Receba alertas se um veículo entrar em área restrita</span>
              </li>
            </ul>
          </div>
          
          <Separator />
          
          <div>
            <p className="font-medium mb-2">Como criar?</p>
            <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
              <li>Clique em <strong className="text-foreground">"Nova Cerca"</strong></li>
              <li>Dê um nome (ex: "Garagem SP") e escolha a categoria</li>
              <li>Pesquise o endereço ou marque o ponto diretamente no mapa</li>
              <li>O sistema cria um círculo no mapa e começa a monitorar</li>
            </ol>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
