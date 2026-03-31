import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, GripVertical, Fuel, Moon, UtensilsCrossed, MapPin, Flag, CircleDot } from 'lucide-react';

export interface Waypoint {
  id?: string;
  waypoint_order: number;
  waypoint_type: string;
  label: string;
  address: string;
  poi_id: string | null;
  geofence_id: string | null;
  estimated_duration_min: number | null;
  notes: string;
}

const WAYPOINT_TYPES = [
  { value: 'origin', label: 'Origem', icon: Flag, color: 'text-green-500' },
  { value: 'destination', label: 'Destino', icon: MapPin, color: 'text-red-500' },
  { value: 'fueling', label: 'Abastecimento', icon: Fuel, color: 'text-amber-500' },
  { value: 'overnight', label: 'Pernoite', icon: Moon, color: 'text-indigo-500' },
  { value: 'meal', label: 'Refeição', icon: UtensilsCrossed, color: 'text-orange-500' },
  { value: 'client', label: 'Cliente/Entrega', icon: MapPin, color: 'text-blue-500' },
  { value: 'checkpoint', label: 'Ponto de passagem', icon: CircleDot, color: 'text-muted-foreground' },
] as const;

const getTypeConfig = (type: string) => WAYPOINT_TYPES.find(t => t.value === type) || WAYPOINT_TYPES[6];

const emptyWaypoint = (order: number, type = 'checkpoint'): Waypoint => ({
  waypoint_order: order,
  waypoint_type: type,
  label: '',
  address: '',
  poi_id: null,
  geofence_id: null,
  estimated_duration_min: null,
  notes: '',
});

interface WaypointEditorProps {
  waypoints: Waypoint[];
  onChange: (waypoints: Waypoint[]) => void;
  pois: any[];
  geofences: any[];
}

export function WaypointEditor({ waypoints, onChange, pois, geofences }: WaypointEditorProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const addWaypoint = (type = 'checkpoint') => {
    const newWp = emptyWaypoint(waypoints.length, type);
    const updated = [...waypoints, newWp];
    onChange(updated);
    setExpandedIdx(updated.length - 1);
  };

  const removeWaypoint = (idx: number) => {
    const updated = waypoints.filter((_, i) => i !== idx).map((wp, i) => ({ ...wp, waypoint_order: i }));
    onChange(updated);
    setExpandedIdx(null);
  };

  const updateWaypoint = (idx: number, partial: Partial<Waypoint>) => {
    const updated = waypoints.map((wp, i) => i === idx ? { ...wp, ...partial } : wp);
    onChange(updated);
  };

  const moveWaypoint = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= waypoints.length) return;
    const updated = [...waypoints];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    onChange(updated.map((wp, i) => ({ ...wp, waypoint_order: i })));
    setExpandedIdx(newIdx);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Pontos da Rota</Label>
        <span className="text-xs text-muted-foreground">{waypoints.length} ponto(s)</span>
      </div>

      {waypoints.length === 0 && (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 p-4 text-center">
          <p className="text-sm text-muted-foreground mb-2">Nenhum ponto adicionado</p>
          <p className="text-xs text-muted-foreground">Adicione origem, destino e paradas estratégicas</p>
        </div>
      )}

      <div className="space-y-2">
        {waypoints.map((wp, idx) => {
          const config = getTypeConfig(wp.waypoint_type);
          const Icon = config.icon;
          const isExpanded = expandedIdx === idx;

          return (
            <div key={idx} className="rounded-lg border bg-card">
              {/* Header row */}
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-mono text-muted-foreground w-5">{idx + 1}</span>
                <Icon className={`h-4 w-4 ${config.color} shrink-0`} />
                <span className="text-sm font-medium truncate flex-1">
                  {wp.label || wp.address || config.label}
                </span>
                {wp.estimated_duration_min && (
                  <Badge variant="outline" className="text-xs shrink-0">{wp.estimated_duration_min} min</Badge>
                )}
                <Badge variant="secondary" className="text-xs shrink-0">{config.label}</Badge>
              </div>

              {/* Expanded form */}
              {isExpanded && (
                <div className="border-t px-3 py-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tipo</Label>
                      <Select value={wp.waypoint_type} onValueChange={v => updateWaypoint(idx, { waypoint_type: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {WAYPOINT_TYPES.map(t => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nome / Label</Label>
                      <Input className="h-8 text-xs" value={wp.label} onChange={e => updateWaypoint(idx, { label: e.target.value })} placeholder="Ex: Posto Shell BR-101" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Endereço</Label>
                    <Input className="h-8 text-xs" value={wp.address} onChange={e => updateWaypoint(idx, { address: e.target.value })} placeholder="Rua, número, cidade - UF" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Vincular POI (opcional)</Label>
                      <Select value={wp.poi_id || '__none__'} onValueChange={v => updateWaypoint(idx, { poi_id: v === '__none__' ? null : v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Nenhum</SelectItem>
                          {pois.map((p: any) => (
                            <SelectItem key={p.id} value={p.id}>{p.name || p.category}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Vincular Geofence (opcional)</Label>
                      <Select value={wp.geofence_id || '__none__'} onValueChange={v => updateWaypoint(idx, { geofence_id: v === '__none__' ? null : v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Nenhum</SelectItem>
                          {geofences.map((g: any) => (
                            <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tempo estimado (min)</Label>
                      <Input className="h-8 text-xs" type="number" value={wp.estimated_duration_min ?? ''} onChange={e => updateWaypoint(idx, { estimated_duration_min: e.target.value ? parseInt(e.target.value) : null })} placeholder="Ex: 30" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Observações</Label>
                      <Input className="h-8 text-xs" value={wp.notes} onChange={e => updateWaypoint(idx, { notes: e.target.value })} placeholder="Notas..." />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex gap-1">
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={idx === 0} onClick={() => moveWaypoint(idx, -1)}>↑ Subir</Button>
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={idx === waypoints.length - 1} onClick={() => moveWaypoint(idx, 1)}>↓ Descer</Button>
                    </div>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => removeWaypoint(idx)}>
                      <Trash2 className="h-3 w-3 mr-1" />Remover
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick-add buttons */}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => addWaypoint('origin')}>
          <Flag className="h-3 w-3 mr-1 text-green-500" />Origem
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => addWaypoint('fueling')}>
          <Fuel className="h-3 w-3 mr-1 text-amber-500" />Abastecimento
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => addWaypoint('meal')}>
          <UtensilsCrossed className="h-3 w-3 mr-1 text-orange-500" />Refeição
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => addWaypoint('overnight')}>
          <Moon className="h-3 w-3 mr-1 text-indigo-500" />Pernoite
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => addWaypoint('client')}>
          <MapPin className="h-3 w-3 mr-1 text-blue-500" />Cliente
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => addWaypoint('destination')}>
          <MapPin className="h-3 w-3 mr-1 text-red-500" />Destino
        </Button>
      </div>
    </div>
  );
}

export { WAYPOINT_TYPES, getTypeConfig };
