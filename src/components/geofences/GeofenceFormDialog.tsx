import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Hexagon, MapPin, Shield } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { LocationPicker } from '@/components/maps/LocationPicker';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { useAuth } from '@/hooks/useAuth';
import { useClients, type Client } from '@/hooks/useClients';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { buildDeliveryAddress, type ResolvedLocation } from '@/lib/geocoding';
import { acknowledgeDurableOperatorCommand, prepareDurableOperatorCommand } from '@/lib/operator/durableOperatorCommand';

const CATEGORIES = [
  { value: 'base', label: 'Base / Garagem', icon: Building2, color: '#22c55e', defaultRadius: 250, description: 'Sua base de operações, garagem ou pátio' },
  { value: 'client', label: 'Cliente', icon: MapPin, color: '#a855f7', defaultRadius: 300, description: 'Local de carga/descarga de um cliente' },
  { value: 'restricted', label: 'Zona Restrita', icon: Shield, color: '#ef4444', defaultRadius: 500, description: 'Área onde veículos não devem entrar' },
  { value: 'general', label: 'Outra', icon: Hexagon, color: '#3b82f6', defaultRadius: 300, description: 'Posto, pernoite, ponto de apoio, etc.' },
] as const;

export interface EditableFleetGeofence {
  id: string;
  name: string;
  category: string | null;
  enabled: boolean;
  shape_kind: string;
  scope_kind: string;
  dispatch_stop_id: string | null;
  client_id?: string | null;
  auto_sync_address?: boolean;
  source_kind: string;
  source_address: string | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  location_provider: string | null;
  location_accuracy_m: number | null;
  location_confidence: number | null;
  location_audit: Json;
  enter_margin_m: number;
  exit_margin_m: number;
  transition_confirmations: number;
}

interface Props {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  tenantId: string;
  geofence?: EditableFleetGeofence | null;
}

function initialLocation(geofence?: EditableFleetGeofence | null): ResolvedLocation | null {
  if (!geofence || geofence.center_lat == null || geofence.center_lng == null) return null;
  return {
    latitude: Number(geofence.center_lat),
    longitude: Number(geofence.center_lng),
    source: geofence.source_kind === 'address_geocoded' ? 'address_geocoded' : 'map_selected',
    address: geofence.source_address,
    provider: geofence.location_provider,
    accuracy_m: geofence.location_accuracy_m,
    confidence: geofence.location_confidence,
    audit: geofence.location_audit,
  };
}

function auditPayload(location: ResolvedLocation, geofence?: EditableFleetGeofence | null): Json {
  const previous = location.audit && typeof location.audit === 'object' && !Array.isArray(location.audit)
    ? location.audit : {};
  return {
    ...previous,
    ui_action: geofence ? 'fleet_geofence_edited' : 'fleet_geofence_created',
    previous_source_kind: geofence?.source_kind ?? null,
  };
}

function clientAddress(client: Client) {
  return buildDeliveryAddress([
    client.address_street,
    client.address_number,
    client.address_complement,
    client.address_neighborhood,
    client.address_city,
    client.address_state,
    client.address_zip,
  ]);
}

function verifiedClientLocation(client: Client): ResolvedLocation | null {
  if (client.address_lat == null || client.address_lng == null) return null;
  const latitude = Number(client.address_lat);
  const longitude = Number(client.address_lng);
  const address = clientAddress(client);
  if (client.address_geocode_status !== 'verified' || !address
    || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return {
    latitude,
    longitude,
    source: 'address_geocoded',
    address,
    provider: client.address_geocode_provider ?? null,
    accuracy_m: client.address_geocode_accuracy_m ?? null,
    confidence: client.address_geocode_confidence ?? null,
    audit: {
      automatic_client_address_sync: true,
      canonical_address_id: client.canonical_address_id ?? null,
    },
  };
}

export function GeofenceFormDialog({ open, onOpenChange, tenantId, geofence }: Props) {
  const toast = useSonnerToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: clients = [], isPending: clientsLoading } = useClients();
  const editing = Boolean(geofence);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('base');
  const [clientId, setClientId] = useState('');
  const [autoSyncAddress, setAutoSyncAddress] = useState(false);
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState<ResolvedLocation | null>(null);
  const [radius, setRadius] = useState('250');
  const [enterMargin, setEnterMargin] = useState('0');
  const [exitMargin, setExitMargin] = useState('30');
  const [confirmations, setConfirmations] = useState('2');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(geofence?.name ?? '');
    setCategory(geofence?.category ?? 'base');
    setClientId(geofence?.client_id ?? '');
    setAutoSyncAddress(Boolean(geofence?.auto_sync_address));
    setAddress(geofence?.source_address ?? '');
    setLocation(initialLocation(geofence));
    setRadius(String(geofence?.radius_m ?? 250));
    setEnterMargin(String(geofence?.enter_margin_m ?? 0));
    setExitMargin(String(geofence?.exit_margin_m ?? 30));
    setConfirmations(String(geofence?.transition_confirmations ?? 2));
    setLoading(false);
  }, [geofence, open]);

  const selectedClient = clients.find((client) => client.id === clientId) ?? null;
  const selectedClientLocation = selectedClient ? verifiedClientLocation(selectedClient) : null;

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    const client = clients.find((item) => item.id === nextClientId);
    const resolved = client ? verifiedClientLocation(client) : null;
    setAutoSyncAddress(Boolean(resolved));
    setAddress(client ? clientAddress(client) : '');
    setLocation(resolved);
  }

  function handleAutoSyncChange(checked: boolean) {
    setAutoSyncAddress(checked);
    if (!checked) return;
    if (!selectedClientLocation) {
      setAutoSyncAddress(false);
      toast.error('O endereço desse cliente ainda não foi validado. Aguarde o processamento ou marque o ponto manualmente.');
      return;
    }
    setAddress(selectedClientLocation.address ?? '');
    setLocation(selectedClientLocation);
  }

  function handleAddressChange(nextAddress: string) {
    setAddress(nextAddress);
    if (nextAddress.trim() !== (location?.address ?? '').trim()) setLocation(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (geofence && (geofence.scope_kind !== 'fleet' || geofence.dispatch_stop_id)) {
      toast.error('Cercas automáticas de entrega só podem ser alteradas pelo destino da parada.');
      return;
    }
    const parsedRadius = Number(radius);
    const parsedEnterMargin = Number(enterMargin);
    const parsedExitMargin = Number(exitMargin);
    const parsedConfirmations = Number(confirmations);
    if (category === 'client' && autoSyncAddress && (!clientId || !selectedClientLocation)) {
      toast.error('Selecione um cliente com endereço validado para ativar a sincronização automática.');
      return;
    }
    if (!location) {
      toast.error('Pesquise o endereço ou marque o ponto no mapa.');
      return;
    }
    if (!user?.id) {
      toast.error('Entre novamente antes de salvar a cerca.');
      return;
    }
    if (!name.trim() || name.trim().length > 200 || !Number.isFinite(parsedRadius) || parsedRadius < 50 || parsedRadius > 50000
      || !Number.isFinite(parsedEnterMargin) || parsedEnterMargin < 0 || parsedEnterMargin > 1000
      || !Number.isFinite(parsedExitMargin) || parsedExitMargin < 0 || parsedExitMargin > 2000
      || !Number.isInteger(parsedConfirmations) || parsedConfirmations < 1 || parsedConfirmations > 10) {
      toast.error('Revise o nome, o raio e a configuração de confirmação da cerca.');
      return;
    }

    const command = {
      ...(geofence ? { id: geofence.id } : {}),
      tenant_id: tenantId,
      name: name.trim(),
      category,
      ...(category === 'client' && clientId ? { client_id: clientId } : {}),
      auto_sync_address: category === 'client' && autoSyncAddress,
      enabled: geofence?.enabled ?? true,
      shape_kind: 'circle',
      scope_kind: 'fleet',
      source_kind: location.source,
      source_address: location.address || address.trim() || null,
      center_lat: location.latitude,
      center_lng: location.longitude,
      radius_m: parsedRadius,
      location_provider: location.provider,
      location_accuracy_m: location.accuracy_m,
      location_confidence: location.confidence,
      location_audit: auditPayload(location, geofence),
      enter_margin_m: parsedEnterMargin,
      exit_margin_m: parsedExitMargin,
      transition_confirmations: parsedConfirmations,
    };
    let pending;
    try {
      pending = await prepareDurableOperatorCommand({
        tenantId,
        actorId: user.id,
        action: 'upsert_geofence',
        entityId: geofence?.id ?? 'new',
        payload: command,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível preservar a solicitação.');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc('upsert_geofence_v4' as never, { _payload: {
      ...command,
      request_id: pending.requestId,
    } } as never);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data || typeof data !== 'object' || (data as Record<string, unknown>).ok !== true
      || (data as Record<string, unknown>).request_id !== pending.requestId) {
      toast.error('A confirmação da cerca não pôde ser validada. A solicitação foi preservada para reenvio.');
      return;
    }
    acknowledgeDurableOperatorCommand(pending);
    toast.success(editing ? `Cerca "${name.trim()}" atualizada.` : `Cerca "${name.trim()}" criada com sucesso!`);
    await queryClient.invalidateQueries({ queryKey: ['geofences'] });
    onOpenChange(false);
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{editing ? 'Editar Cerca de Frota' : 'Nova Cerca Virtual'}</DialogTitle>
        <DialogDescription>
          {editing ? 'Ajuste o endereço ou arraste o marcador para o acesso real. As cercas de entrega são geradas pela rota e não são editáveis aqui.'
            : 'Defina um endereço ou ponto no mapa, o raio e a confirmação do monitoramento.'}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="geofence-name">Nome da cerca</Label>
          <Input id="geofence-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={200}
            placeholder="Ex: Garagem SP, Cliente ABC, Posto BR-101" />
        </div>

        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((item) => {
              const Icon = item.icon;
              const selected = category === item.value;
              return <button type="button" key={item.value} onClick={() => {
                setCategory(item.value);
                if (item.value !== 'client') {
                  setClientId('');
                  setAutoSyncAddress(false);
                }
                if (!editing) setRadius(String(item.defaultRadius));
              }} className={`flex items-center gap-2 rounded-lg border p-2.5 text-left transition-all ${selected
                ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50'}`}>
                <Icon className="h-4 w-4 shrink-0" style={{ color: item.color }} />
                <div><p className="text-xs font-medium">{item.label}</p>
                  <p className="text-[10px] leading-tight text-muted-foreground">{item.description}</p></div>
              </button>;
            })}
          </div>
        </div>

        {category === 'client' ? <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="geofence-client">Cliente vinculado</Label>
            <Select value={clientId} onValueChange={handleClientChange} disabled={loading || clientsLoading}>
              <SelectTrigger id="geofence-client">
                <SelectValue placeholder={clientsLoading ? 'Carregando clientes…' : 'Selecione o cliente'} />
              </SelectTrigger>
              <SelectContent>
                {clients.filter((client) => client.active && client.is_client !== false).map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.company_name}{client.address_geocode_status === 'verified' ? '' : ' · endereço pendente'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="geofence-auto-sync">Sincronizar endereço automaticamente</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Mantém a cerca alinhada à fonte canônica do cliente sempre que o cadastro mudar.
              </p>
            </div>
            <Switch id="geofence-auto-sync" checked={autoSyncAddress} onCheckedChange={handleAutoSyncChange}
              disabled={loading || !clientId} aria-label="Sincronizar endereço do cliente automaticamente" />
          </div>
          {clientId && !selectedClientLocation ? <p role="status" className="text-xs text-amber-600">
            O endereço cadastrado ainda está em validação. Você pode aguardar a automação ou desativar a sincronização e marcar o acesso no mapa.
          </p> : null}
        </div> : null}

        <Separator />
        <LocationPicker tenantId={tenantId} idPrefix={geofence ? `geofence-${geofence.id}` : 'new-geofence'}
          address={address} value={location} onAddressChange={handleAddressChange} onChange={(nextLocation) => {
            setLocation(nextLocation);
            if (nextLocation.source === 'map_selected') setAutoSyncAddress(false);
          }} disabled={loading || autoSyncAddress} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="geofence-radius">Raio (metros)</Label>
            <Input id="geofence-radius" type="number" value={radius} onChange={(event) => setRadius(event.target.value)} required min={50} max={50000} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="geofence-exit-margin">Histerese de saída (m)</Label>
            <Input id="geofence-exit-margin" type="number" value={exitMargin} onChange={(event) => setExitMargin(event.target.value)} required min={0} max={2000} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="geofence-enter-margin">Margem de entrada (m)</Label>
            <Input id="geofence-enter-margin" type="number" value={enterMargin} onChange={(event) => setEnterMargin(event.target.value)} required min={0} max={1000} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="geofence-confirmations">Posições para confirmar</Label>
            <Input id="geofence-confirmations" type="number" value={confirmations}
              onChange={(event) => setConfirmations(event.target.value)} required min={1} max={10} step={1} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          A histerese evita entradas e saídas repetidas perto da borda. Exigir duas posições consecutivas reduz falsos eventos de GPS.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar Cerca'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
