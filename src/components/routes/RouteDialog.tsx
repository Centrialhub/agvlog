import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { WaypointEditor } from './WaypointEditor';
import type { Waypoint } from '@/lib/routes/waypoints';
import type { Json, Tables } from '@/integrations/supabase/types';
import { getErrorMessage } from '@/lib/errors';
import {useAuth} from '@/hooks/useAuth';
import {acknowledgeDurableOperatorCommand,prepareDurableOperatorCommand} from '@/lib/operator/durableOperatorCommand';

type RouteTemplate = Tables<'route_templates'>;
type GeofenceOption = Pick<Tables<'geofences'>, 'id' | 'name' | 'category'>;
type PoiOption = Pick<Tables<'pois'>, 'id' | 'name' | 'category'>;

interface RouteDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId?: string;
  geofences: GeofenceOption[];
  pois: PoiOption[];
  editRoute: RouteTemplate | null;
}

export function RouteDialog({ open, onOpenChange, tenantId, geofences, pois, editRoute }: RouteDialogProps) {
  const {user}=useAuth();
  const toast = useSonnerToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [corridorId, setCorridorId] = useState('');
  const [threshold, setThreshold] = useState('85');
  const [outsideMin, setOutsideMin] = useState('5');
  const [speedLimit, setSpeedLimit] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);

  // Load existing waypoints when editing
  const existingWaypointsQuery = useQuery({
    queryKey: ['route_waypoints', editRoute?.id],
    queryFn: async () => {
      if (!editRoute?.id) return [];
      const { data, error } = await supabase
        .from('route_waypoints')
        .select('*')
        .eq('route_id', editRoute.id)
        .order('waypoint_order');
      if (error) throw error;
      return data;
    },
    enabled: !!editRoute?.id && open,
  });
  // Reset form when dialog opens (only once per open)
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!open) {
      setInitialized(false);
      return;
    }
    if (initialized) return;
    if (editRoute) {
      setName(editRoute.name || '');
      setCorridorId(editRoute.corridor_geofence_id || '');
      setThreshold(String(Math.round((editRoute.corridor_inside_ratio_threshold || 0.85) * 100)));
      setOutsideMin(String(editRoute.allowed_outside_minutes ?? 5));
      setSpeedLimit(editRoute.route_speed_limit_kmh ? String(editRoute.route_speed_limit_kmh) : '');
      setEnabled(editRoute.enabled ?? true);
    } else {
      setName(''); setCorridorId('');
      setThreshold('85'); setOutsideMin('5'); setSpeedLimit(''); setEnabled(true);
      setWaypoints([]);
      setInitialized(true);
    }
  }, [open, editRoute, initialized]);

  // Load existing waypoints when editing (only once after they load)
  useEffect(() => {
    if (!open || !editRoute || initialized || !existingWaypointsQuery.isSuccess) return;
    {
      setWaypoints((existingWaypointsQuery.data ?? []).map((w) => ({
        id: w.id,
        waypoint_order: w.waypoint_order,
        waypoint_type: w.waypoint_type,
        label: w.label || '',
        address: w.address || '',
        poi_id: w.poi_id,
        geofence_id: w.geofence_id,
        estimated_duration_min: w.estimated_duration_min,
        notes: w.notes || '',
      })));
      setInitialized(true);
    }
  }, [open, editRoute, existingWaypointsQuery.data, existingWaypointsQuery.isSuccess, initialized]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !user) return;
    if (!name.trim()) {
      toast.error('Informe o nome da rota');
      return;
    }
    if (editRoute && !existingWaypointsQuery.isSuccess) {
      toast.error('Aguarde o carregamento completo dos pontos da rota');
      return;
    }
    const thresholdPercent = Number(threshold);
    const outside = Number(outsideMin);
    const speed = speedLimit === '' ? null : Number(speedLimit);
    if (!Number.isFinite(thresholdPercent) || thresholdPercent < 50 || thresholdPercent > 100
      || !Number.isFinite(outside) || outside < 0
      || (speed != null && (!Number.isFinite(speed) || speed < 0))
      || waypoints.some(point => Number(point.estimated_duration_min ?? 0) < 0)) {
      toast.error('Revise os limites de monitoramento e a duração dos pontos da rota');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        tenant_id: tenantId,
        route_id: editRoute?.id ?? null,
        name: name.trim(),
        corridor_geofence_id: corridorId || null,
        start_poi_id: null,
        end_poi_id: null,
        corridor_inside_ratio_threshold: thresholdPercent / 100,
        allowed_outside_minutes: outside,
        route_speed_limit_kmh: speed,
        enabled,
      };
      const command={
          ...payload,
          expected_revision: editRoute?.revision ?? null,
          waypoints: waypoints.map((wp, i) => ({
          waypoint_order: i,
          waypoint_type: wp.waypoint_type,
          label: wp.label || null,
          address: wp.address || null,
          poi_id: wp.poi_id || null,
          geofence_id: wp.geofence_id || null,
          estimated_duration_min: wp.estimated_duration_min,
          notes: wp.notes || null,
          })),
        };
      const pending=await prepareDurableOperatorCommand({tenantId,actorId:user.id,action:'save_route_template',entityId:editRoute?.id??'new',payload:command});
      const { error } = await supabase.rpc('save_route_template_v1', {
        _payload: {...command,request_id:pending.requestId} as unknown as Json,
      });
      if (error) throw error;
      acknowledgeDurableOperatorCommand(pending);

      toast.success(editRoute ? 'Rota atualizada' : 'Rota criada');
      queryClient.invalidateQueries({ queryKey: ['route_templates'] });
      queryClient.invalidateQueries({ queryKey: ['route_waypoints'] });
      queryClient.invalidateQueries({ queryKey: ['route_waypoints_all'] });
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error));
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle>{editRoute ? 'Editar Rota' : 'Nova Rota'}</DialogTitle>
          <DialogDescription>Defina os pontos estratégicos e os limites usados para monitorar este corredor.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(90vh-80px)]">
          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-5">
            {/* Basic info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nome da Rota</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: SP → RJ via Dutra" required />
              </div>
              <div className="space-y-1.5">
                <Label>Corredor (Geofence)</Label>
                <Select value={corridorId || '__none__'} onValueChange={v => setCorridorId(v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Nenhum</SelectItem>
                    {geofences.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name} ({g.category})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Waypoints */}
            <WaypointEditor waypoints={waypoints} onChange={setWaypoints} pois={pois} geofences={geofences} />

            <Separator />

            {/* Monitoring settings */}
            <div>
              <Label className="text-sm font-medium mb-2 block">Monitoramento do Corredor</Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Threshold (%)</Label>
                  <Input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} min={50} max={100} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Máx. fora (min)</Label>
                  <Input type="number" value={outsideMin} onChange={e => setOutsideMin(e.target.value)} min={0} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Vel. máx (km/h)</Label>
                  <Input type="number" min={0} value={speedLimit} onChange={e => setSpeedLimit(e.target.value)} placeholder="Opcional" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <Label>Rota ativa</Label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={
                loading
                || !tenantId
                || !user
                || !name.trim()
                || (editRoute != null && !existingWaypointsQuery.isSuccess)
                || !Number.isFinite(Number(threshold))
                || Number(threshold) < 50
                || Number(threshold) > 100
                || !Number.isFinite(Number(outsideMin))
                || Number(outsideMin) < 0
                || (speedLimit !== '' && (!Number.isFinite(Number(speedLimit)) || Number(speedLimit) < 0))
                || waypoints.some(point => Number(point.estimated_duration_min ?? 0) < 0)
              }>{loading ? 'Salvando...' : 'Salvar'}</Button>
            </div>
          </form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
