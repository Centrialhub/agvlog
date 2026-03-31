import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { WaypointEditor, type Waypoint } from './WaypointEditor';

interface RouteDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId?: string;
  geofences: any[];
  pois: any[];
  editRoute: any;
}

export function RouteDialog({ open, onOpenChange, tenantId, geofences, pois, editRoute }: RouteDialogProps) {
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
  const { data: existingWaypoints = [] } = useQuery({
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

  useEffect(() => {
    if (!open) return;
    if (editRoute) {
      setName(editRoute.name || '');
      setCorridorId(editRoute.corridor_geofence_id || '');
      setThreshold(String(Math.round((editRoute.corridor_inside_ratio_threshold || 0.85) * 100)));
      setOutsideMin(String(editRoute.allowed_outside_minutes || 5));
      setSpeedLimit(editRoute.route_speed_limit_kmh ? String(editRoute.route_speed_limit_kmh) : '');
      setEnabled(editRoute.enabled ?? true);
      setWaypoints(existingWaypoints.map((w: any) => ({
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
    } else {
      setName(''); setCorridorId('');
      setThreshold('85'); setOutsideMin('5'); setSpeedLimit(''); setEnabled(true);
      setWaypoints([]);
    }
  }, [open, editRoute, existingWaypoints]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !name) return;
    setLoading(true);
    try {
      const payload = {
        tenant_id: tenantId,
        name,
        corridor_geofence_id: corridorId || null,
        start_poi_id: null,
        end_poi_id: null,
        corridor_inside_ratio_threshold: parseInt(threshold) / 100,
        allowed_outside_minutes: parseInt(outsideMin) || 5,
        route_speed_limit_kmh: speedLimit ? parseInt(speedLimit) : null,
        enabled,
      };

      let routeId: string;

      if (editRoute) {
        const { error } = await supabase.from('route_templates').update(payload).eq('id', editRoute.id);
        if (error) throw error;
        routeId = editRoute.id;
      } else {
        const { data, error } = await supabase.from('route_templates').insert(payload).select('id').single();
        if (error) throw error;
        routeId = data.id;
      }

      // Sync waypoints: delete all then re-insert
      await supabase.from('route_waypoints').delete().eq('route_id', routeId);

      if (waypoints.length > 0) {
        const wpRows = waypoints.map((wp, i) => ({
          tenant_id: tenantId,
          route_id: routeId,
          waypoint_order: i,
          waypoint_type: wp.waypoint_type,
          label: wp.label || null,
          address: wp.address || null,
          poi_id: wp.poi_id || null,
          geofence_id: wp.geofence_id || null,
          estimated_duration_min: wp.estimated_duration_min,
          notes: wp.notes || null,
        }));
        const { error: wpErr } = await supabase.from('route_waypoints').insert(wpRows as any);
        if (wpErr) throw wpErr;
      }

      toast.success(editRoute ? 'Rota atualizada' : 'Rota criada');
      queryClient.invalidateQueries({ queryKey: ['route_templates'] });
      queryClient.invalidateQueries({ queryKey: ['route_waypoints'] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle>{editRoute ? 'Editar Rota' : 'Nova Rota'}</DialogTitle>
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
                    {geofences.map((g: any) => (
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
                  <Input type="number" value={speedLimit} onChange={e => setSpeedLimit(e.target.value)} placeholder="Opcional" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <Label>Rota ativa</Label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Button>
            </div>
          </form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
