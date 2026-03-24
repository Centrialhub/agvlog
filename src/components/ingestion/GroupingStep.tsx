import { useState } from 'react';
import { LoadSuggestion } from '@/lib/ingestionValidator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, AlertTriangle, CheckCircle, Loader2, Truck, User } from 'lucide-react';

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

interface GroupingStepProps {
  suggestions: LoadSuggestion[];
  vehicles: Vehicle[];
  drivers: Driver[];
  executing: boolean;
  onBack: () => void;
  onExecute: (assignments: Map<number, { vehicleId: string | null; driverId: string | null }>) => void;
}

export default function GroupingStep({ suggestions, vehicles, drivers, executing, onBack, onExecute }: GroupingStepProps) {
  const [assignments, setAssignments] = useState<Map<number, { vehicleId: string | null; driverId: string | null }>>(new Map());

  const vehiclesWithCapacity = vehicles.filter(v => (v.max_pallets || 0) > 0);
  const activeDrivers = drivers.filter(d => d.active);

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
    const assignedVehicle = assignment?.vehicleId ? vehicles.find(v => v.id === assignment.vehicleId) : null;
    const vehicle = assignedVehicle || vehiclesWithCapacity.find(v => (v.max_pallets || 0) >= suggestion.totalPallets);
    if (!vehicle || !vehicle.max_pallets) return null;
    return { pct: Math.round((suggestion.totalPallets / vehicle.max_pallets) * 100), vehicle };
  };

  return (
    <div className="space-y-4">
      {suggestions.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma sugestão gerada — verifique os dados importados</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s, i) => {
            const occ = getOccupancy(s, i);
            const isUnder = occ && occ.pct < 50;
            const isOver = occ && occ.pct > 100;
            const assignment = assignments.get(i);

            return (
              <Card key={i} className={isOver ? 'border-destructive/30' : ''}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{s.region}</span>
                        <Badge variant="outline" className="text-[10px]">{s.documents.length} NF-e</Badge>
                        {s.orders.length > 0 && <Badge variant="outline" className="text-[10px]">{s.orders.length} pedidos</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{s.totalPallets} paletes</span>
                        {s.totalWeight > 0 && <span>{s.totalWeight} kg</span>}
                        {s.totalValue > 0 && <span>R$ {s.totalValue.toLocaleString('pt-BR')}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <Select
                        value={assignment?.vehicleId || '__none__'}
                        onValueChange={v => setAssignment(i, 'vehicleId', v === '__none__' ? null : v)}
                      >
                        <SelectTrigger className="w-[130px] h-8 text-xs">
                          <SelectValue placeholder="Veículo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sem veículo</SelectItem>
                          {vehiclesWithCapacity.map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.plate} <span className="text-muted-foreground ml-1">({v.max_pallets}p)</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

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
                        <div className="w-20 text-center">
                          <Progress value={Math.min(occ.pct, 100)} className={`h-2 ${isOver ? '[&>div]:bg-destructive' : isUnder ? '[&>div]:bg-warning' : ''}`} />
                          <span className={`text-[10px] font-medium ${isOver ? 'text-destructive' : isUnder ? 'text-warning' : 'text-muted-foreground'}`}>
                            {occ.pct}%{isOver ? ' Excede!' : isUnder ? ' Baixa' : ''}
                          </span>
                        </div>
                      ) : (
                        <div className="w-20 text-center text-[10px] text-muted-foreground">Sem veículo</div>
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
