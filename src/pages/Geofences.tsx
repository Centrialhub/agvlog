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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useListFilters } from '@/hooks/useListFilters';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { matchesSearch } from '@/lib/listFilters';
import { Separator } from '@/components/ui/separator';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import {
  Hexagon, Plus, Trash2, MapPin, Shield, Truck, Building2,
  Info, ArrowDownUp, Eye, EyeOff, HelpCircle, AlertTriangle, RefreshCw
} from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const CATEGORIES = [
  { value: 'base', label: 'Base / Garagem', icon: Building2, color: '#22c55e', description: 'Sua base de operações, garagem ou pátio' },
  { value: 'client', label: 'Cliente', icon: MapPin, color: '#a855f7', description: 'Local de carga/descarga de um cliente' },
  { value: 'restricted', label: 'Zona Restrita', icon: Shield, color: '#ef4444', description: 'Área onde veículos não devem entrar' },
  { value: 'general', label: 'Outra', icon: Hexagon, color: '#3b82f6', description: 'Posto, pernoite, ponto de apoio, etc.' },
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
  const { filters, setFilter, resetFilters, activeCount: filterCount } = useListFilters({ search: '', category: 'all', status: 'all' });
  const [showHelp, setShowHelp] = useState(false);

  const { data: geofences = [], isLoading } = useQuery({
    queryKey: ['geofences', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('geofences')
        .select('id, tenant_id, name, category, enabled, created_at')
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
      const { error } = await supabase.from('geofences').update({ enabled })
        .eq('id', id)
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['geofences'] }); },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao atualizar geofence')),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase.from('geofences').delete()
        .eq('id', id)
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
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
      {positions.length > 0 && (
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
                center={[positions[0].lat, positions[0].lng]}
                zoom={10}
                className="h-full w-full z-0"
              >
                <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
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

                return (
                  <div key={g.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: config.color + '20' }}>
                      <Icon className="h-4 w-4" style={{ color: config.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{g.name}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{config.label}</Badge>
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
                      {isAdmin && (
                        <>
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
      {isAdmin && <NewGeofenceDialog open={dialogOpen} onOpenChange={setDialogOpen} tenantId={currentTenant?.id} />}
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
              <li>Informe as coordenadas do centro e o raio em metros</li>
              <li>O sistema cria um círculo no mapa e começa a monitorar</li>
            </ol>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Create Dialog ─── */
function NewGeofenceDialog({ open, onOpenChange, tenantId }: { open: boolean; onOpenChange: (v: boolean) => void; tenantId?: string }) {
  const toast = useSonnerToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('base');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('200');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setLoading(true);

    const cLat = parseFloat(lat);
    const cLng = parseFloat(lng);
    const r = parseFloat(radius);

    if (isNaN(cLat) || isNaN(cLng) || cLat < -90 || cLat > 90 || cLng < -180 || cLng > 180) {
      toast.error('Coordenadas inválidas. Latitude: -90 a 90, Longitude: -180 a 180');
      setLoading(false);
      return;
    }

    const coords: [number, number][] = [];
    for (let i = 0; i <= 32; i++) {
      const angle = (i / 32) * 2 * Math.PI;
      const dLat = (r / 111320) * Math.cos(angle);
      const dLng = (r / (111320 * Math.cos(cLat * Math.PI / 180))) * Math.sin(angle);
      coords.push([cLng + dLng, cLat + dLat]);
    }

    const geojson = JSON.stringify({ type: 'Polygon', coordinates: [coords] });

    const { error } = await supabase.rpc('upsert_geofence', {
      _id: null as never,
      _tenant_id: tenantId,
      _name: name,
      _category: category,
      _geojson: geojson,
      _enabled: true,
    });

    if (error) toast.error(error.message);
    else {
      toast.success(`Cerca "${name}" criada com sucesso!`);
      qc.invalidateQueries({ queryKey: ['geofences'] });
      onOpenChange(false);
      setName(''); setLat(''); setLng(''); setRadius('200'); setCategory('base');
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova Cerca Virtual</DialogTitle>
          <DialogDescription>
            Defina um ponto central e um raio. O sistema criará uma área circular de monitoramento.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label>Nome da cerca</Label>
            <Input value={name} onChange={e => setName(e.target.value)} required placeholder="Ex: Garagem SP, Cliente ABC, Posto BR-101" />
          </div>

          {/* Category with visual selector */}
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map(cat => {
                const Icon = cat.icon;
                const isSelected = category === cat.value;
                return (
                  <button
                    type="button"
                    key={cat.value}
                    onClick={() => setCategory(cat.value)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" style={{ color: cat.color }} />
                    <div>
                      <p className="text-xs font-medium">{cat.label}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">{cat.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Coordinates */}
          <div>
            <Label className="text-sm font-medium mb-2 block">Localização do centro</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Dica: abra o Google Maps, clique com o botão direito no local e copie as coordenadas.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Latitude</Label>
                <Input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} required placeholder="-23.5505" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Longitude</Label>
                <Input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} required placeholder="-46.6333" />
              </div>
            </div>
          </div>

          {/* Radius */}
          <div className="space-y-1.5">
            <Label>Raio (metros)</Label>
            <Input type="number" value={radius} onChange={e => setRadius(e.target.value)} required min={50} max={50000} />
            <p className="text-xs text-muted-foreground">
              {parseInt(radius) < 200 ? '⚠ Raio pequeno — ideal para pontos específicos' :
               parseInt(radius) > 2000 ? '⚠ Raio grande — cobre uma área ampla' :
               '✓ Raio adequado para a maioria dos casos'}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Criando...' : 'Criar Cerca'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
