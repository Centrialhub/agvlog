import { useState, useEffect, useMemo } from 'react';
import { LoadSuggestion } from '@/lib/ingestionValidator';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, CheckCircle, Loader2, MapPin, Truck, AlertTriangle } from 'lucide-react';

interface Vehicle {
  id: string;
  plate: string;
  nickname: string | null;
  max_pallets: number | null;
  max_weight_kg: number | null;
}

interface Driver {
  id: string;
  name: string;
  active: boolean;
}

interface OperationalRouteOption {
  id: string;
  name: string;
  destinations: { name: string }[];
}

interface GroupingStepProps {
  suggestions: LoadSuggestion[];
  vehicles: Vehicle[];
  drivers: Driver[];
  routes?: OperationalRouteOption[];
  executing: boolean;
  onBack: () => void;
  onExecute: (assignments: Map<number, { vehicleId: string | null; driverId: string | null }>) => void;
}

function findBestVehicle(
  pallets: number,
  weightKg: number,
  vehicles: Vehicle[],
  alreadyAssigned: Set<string>,
): Vehicle | null {
  // Find the smallest vehicle that fits both pallets and weight, not already assigned
  const candidates = vehicles
    .filter(v => !alreadyAssigned.has(v.id))
    .filter(v => {
      const fitsPallets = (v.max_pallets || 0) >= pallets;
      const fitsWeight = !weightKg || !v.max_weight_kg || v.max_weight_kg >= weightKg;
      return fitsPallets && fitsWeight;
    })
    .sort((a, b) => (a.max_pallets || 0) - (b.max_pallets || 0));

  return candidates[0] || null;
}

export default function GroupingStep({ suggestions, vehicles, drivers, routes = [], executing, onBack, onExecute }: GroupingStepProps) {
  const [assignments, setAssignments] = useState<Map<number, { vehicleId: string | null; driverId: string | null }>>(new Map());
  const [autoSuggested, setAutoSuggested] = useState(false);

  const vehiclesWithCapacity = useMemo(() => vehicles.filter(v => (v.max_pallets || 0) > 0), [vehicles]);
  const activeDrivers = drivers.filter(d => d.active);

  // Auto-suggest vehicles on mount
  useEffect(() => {
    if (autoSuggested || vehiclesWithCapacity.length === 0 || suggestions.length === 0) return;

    const newAssignments = new Map<number, { vehicleId: string | null; driverId: string | null }>();
    const usedVehicles = new Set<string>();

    // Sort suggestions by pallets desc so bigger loads get priority
    const sortedIndices = suggestions
      .map((s, i) => ({ s, i }))
      .sort((a, b) => b.s.totalPallets - a.s.totalPallets);

    for (const { s, i } of sortedIndices) {
      const best = findBestVehicle(s.totalPallets, s.totalWeight, vehiclesWithCapacity, usedVehicles);
      if (best) {
        usedVehicles.add(best.id);
        newAssignments.set(i, { vehicleId: best.id, driverId: null });
      }
    }

    if (newAssignments.size > 0) {
      setAssignments(newAssignments);
    }
    setAutoSuggested(true);
  }, [suggestions, vehiclesWithCapacity, autoSuggested]);

  const setAssignment = (idx: number, field: 'vehicleId' | 'driverId', value: string | null) => {
    setAssignments(prev => {
      const next = new Map(prev);
      const current = next.get(idx) || { vehicleId: null, driverId: null };
      next.set(idx, { ...current, [field]: value });
      return next;
    });
  };

  const getOccupancy = (suggestion: LoadSuggestion, idx: number) => {
    const assignment = assignments.get(idx);
    const vehicle = assignment?.vehicleId ? vehicles.find(v => v.id === assignment.vehicleId) : null;
    if (!vehicle || !vehicle.max_pallets) return null;

    const palletPct = Math.round((suggestion.totalPallets / vehicle.max_pallets) * 100);
    const weightPct = vehicle.max_weight_kg && suggestion.totalWeight > 0
      ? Math.round((suggestion.totalWeight / vehicle.max_weight_kg) * 100)
      : null;
    const maxPct = Math.max(palletPct, weightPct || 0);

    return { palletPct, weightPct, maxPct, vehicle };
  };

  const noVehiclesWithCapacity = vehiclesWithCapacity.length === 0;

  return (
    <div className="space-y-4">
      {noVehiclesWithCapacity && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <div className="text-sm">
              <span className="font-medium text-warning">Nenhum veículo com capacidade cadastrada.</span>{' '}
              <span className="text-muted-foreground">
                Cadastre paletes máx. e peso máx. nos veículos para sugestão automática.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {suggestions.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma sugestão gerada — verifique os dados importados</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s, i) => {
            const occ = getOccupancy(s, i);
            const isOver = occ && occ.maxPct > 100;
            const isUnder = occ && occ.maxPct < 50;
            const assignment = assignments.get(i);
            const isAutoSuggested = assignment?.vehicleId && autoSuggested;

            return (
              <Card key={i} className={isOver ? 'border-destructive/30' : ''}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {s.routeName ? (
                          <Badge className="bg-primary/10 text-primary border-primary/20 gap-1">
                            <MapPin className="h-3 w-3" />
                            {s.routeName}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-warning border-warning/30">
                            <MapPin className="h-3 w-3" />
                            {s.region}
                            <span className="text-[9px] ml-1">(sem rota)</span>
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">{s.documents.length} NF-e</Badge>
                        {s.orders.length > 0 && <Badge variant="outline" className="text-[10px]">{s.orders.length} pedidos</Badge>}
                      </div>
                      {s.routeName && s.documents.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {[...new Set(s.documents.map(d => d.source.recipientCity).filter(Boolean))].map((city, ci) => (
                            <span key={ci} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{city}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{s.totalPallets} paletes</span>
                        {s.totalWeight > 0 && <span>{s.totalWeight.toLocaleString('pt-BR')} kg</span>}
                        {s.totalValue > 0 && <span>R$ {s.totalValue.toLocaleString('pt-BR')}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="relative">
                        <Select
                          value={assignment?.vehicleId || '__none__'}
                          onValueChange={v => setAssignment(i, 'vehicleId', v === '__none__' ? null : v)}
                        >
                          <SelectTrigger className={`w-[150px] h-8 text-xs ${isAutoSuggested && assignment?.vehicleId ? 'border-primary/40 bg-primary/5' : ''}`}>
                            <SelectValue placeholder="Veículo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sem veículo</SelectItem>
                            {vehiclesWithCapacity.map(v => (
                              <SelectItem key={v.id} value={v.id}>
                                <div className="flex items-center gap-1">
                                  <Truck className="h-3 w-3 shrink-0" />
                                  <span>{v.plate}</span>
                                  <span className="text-muted-foreground">
                                    ({v.max_pallets}p{v.max_weight_kg ? ` / ${(v.max_weight_kg / 1000).toFixed(0)}t` : ''})
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                            {vehicles.filter(v => !(v.max_pallets && v.max_pallets > 0)).length > 0 && (
                              <>
                                <div className="px-2 py-1 text-[10px] text-muted-foreground border-t">Sem capacidade cadastrada:</div>
                                {vehicles.filter(v => !(v.max_pallets && v.max_pallets > 0)).map(v => (
                                  <SelectItem key={v.id} value={v.id}>
                                    {v.plate} {v.nickname ? `(${v.nickname})` : ''}
                                  </SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
                        {isAutoSuggested && assignment?.vehicleId && (
                          <span className="absolute -top-2 -right-1 text-[8px] bg-primary text-primary-foreground px-1 rounded">auto</span>
                        )}
                      </div>

                      <Select
                        value={assignment?.driverId || '__none__'}
                        onValueChange={v => setAssignment(i, 'driverId', v === '__none__' ? null : v)}
                      >
                        <SelectTrigger className="w-[130px] h-8 text-xs">
                          <SelectValue placeholder="Motorista" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sem motorista</SelectItem>
                          {activeDrivers.map(d => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {occ ? (
                        <div className="w-24 text-center space-y-0.5">
                          <div>
                            <Progress value={Math.min(occ.palletPct, 100)} className={`h-1.5 ${occ.palletPct > 100 ? '[&>div]:bg-destructive' : occ.palletPct < 50 ? '[&>div]:bg-warning' : ''}`} />
                            <span className={`text-[9px] ${occ.palletPct > 100 ? 'text-destructive' : 'text-muted-foreground'}`}>
                              {occ.palletPct}% paletes
                            </span>
                          </div>
                          {occ.weightPct !== null && (
                            <div>
                              <Progress value={Math.min(occ.weightPct, 100)} className={`h-1.5 ${occ.weightPct > 100 ? '[&>div]:bg-destructive' : occ.weightPct < 50 ? '[&>div]:bg-warning' : ''}`} />
                              <span className={`text-[9px] ${occ.weightPct > 100 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                {occ.weightPct}% peso
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="w-24 text-center text-[10px] text-muted-foreground">Sem veículo</div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex gap-3 justify-between">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Button>
        <Button onClick={() => onExecute(assignments)} disabled={executing || suggestions.length === 0}>
          {executing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Executando...</> : <>Confirmar e Executar <CheckCircle className="h-4 w-4 ml-2" /></>}
        </Button>
      </div>
    </div>
  );
}
