import { useState } from 'react';
import { LoadSuggestion } from '@/lib/ingestionValidator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Truck className="h-4 w-4" /> Sugestões de Carga por Região
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Região</TableHead>
                <TableHead>Docs</TableHead>
                <TableHead>Pedidos</TableHead>
                <TableHead>Paletes</TableHead>
                <TableHead>Peso</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead>Motorista</TableHead>
                <TableHead>Ocupação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhuma sugestão gerada</TableCell></TableRow>
              ) : suggestions.map((s, i) => {
                const occ = getOccupancy(s, i);
                const isUnder = occ && occ.pct < 50;
                const isOver = occ && occ.pct > 100;
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{s.region}</TableCell>
                    <TableCell>{s.documents.length}</TableCell>
                    <TableCell>{s.orders.length}</TableCell>
                    <TableCell className="font-medium">{s.totalPallets}</TableCell>
                    <TableCell>{s.totalWeight ? `${s.totalWeight} kg` : '—'}</TableCell>
                    <TableCell>
                      <Select
                        value={assignments.get(i)?.vehicleId || ''}
                        onValueChange={v => setAssignment(i, 'vehicleId', v || null)}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs">
                          <SelectValue placeholder="Selecionar" />
                        </SelectTrigger>
                        <SelectContent>
                          {vehiclesWithCapacity.map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              <span className="flex items-center gap-1">
                                {v.plate}
                                <Badge variant="outline" className="text-[10px] ml-1">{v.max_pallets}p</Badge>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={assignments.get(i)?.driverId || ''}
                        onValueChange={v => setAssignment(i, 'driverId', v || null)}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs">
                          <SelectValue placeholder="Selecionar" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeDrivers.map(d => (
                            <SelectItem key={d.id} value={d.id}>
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" /> {d.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {occ ? (
                        <div className="flex items-center gap-2">
                          <Progress value={Math.min(occ.pct, 100)} className={`w-16 h-2 ${isOver ? '[&>div]:bg-destructive' : isUnder ? '[&>div]:bg-warning' : ''}`} />
                          <span className={`text-xs font-medium ${isOver ? 'text-destructive' : isUnder ? 'text-warning' : ''}`}>
                            {occ.pct}%
                            {isOver && ' ⚠️ Excede'}
                            {isUnder && ' ⚠️ Baixa'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem veículo</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-between">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Button>
        <Button onClick={() => onExecute(assignments)} disabled={executing || suggestions.length === 0}>
          {executing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Executando...</> : <>Confirmar e Executar <CheckCircle className="h-4 w-4 ml-2" /></>}
        </Button>
      </div>
    </div>
  );
}
