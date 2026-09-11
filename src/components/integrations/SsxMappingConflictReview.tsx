import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type VehicleOption = { id: string; plate: string; nickname?: string | null };

export type SsxMappingConflict = {
  id: string;
  external_code: string;
  observed_plate?: string | null;
  conflict_type: 'ambiguous_plate_match' | 'mapping_conflict';
  first_observed_at: string;
  last_observed_at: string;
  due_at: string;
  occurrence_count: number;
  candidate_vehicles: VehicleOption[];
  linked_vehicle?: VehicleOption | null;
};

export function SsxMappingConflictReview({ conflicts }: { conflicts: SsxMappingConflict[] }) {
  const { currentTenant } = useTenant();
  const queryClient = useQueryClient();
  const toast = useSonnerToast();
  const [vehicleByConflict, setVehicleByConflict] = useState<Record<string, string>>({});
  const [reasonByConflict, setReasonByConflict] = useState<Record<string, string>>({});

  const resolveMutation = useMutation({
    mutationFn: async ({ conflictId, vehicleId, reason }: { conflictId: string; vehicleId: string; reason: string }) => {
      const { error } = await supabase.rpc('resolve_ssx_mapping_conflict_v1' as never, {
        _conflict_id: conflictId,
        _vehicle_id: vehicleId,
        _reason: reason,
      } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success('Conflito SSX resolvido e vínculo auditado.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ssx_mapping_conflicts', currentTenant?.id] }),
        queryClient.invalidateQueries({ queryKey: ['tracking-observability', currentTenant?.id] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Não foi possível resolver o conflito SSX.'),
  });

  if (conflicts.length === 0) return null;

  return <Card>
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-base text-destructive">
        <AlertTriangle className="h-4 w-4" /> Fila de conflitos de mapeamento ({conflicts.length})
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      {conflicts.map((conflict) => {
        const selectedVehicle = vehicleByConflict[conflict.id] || '';
        const reason = reasonByConflict[conflict.id] || '';
        const overdue = new Date(conflict.due_at).getTime() < Date.now();
        return <div key={conflict.id} className="space-y-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Unidade {conflict.external_code}</span>
            <Badge variant="outline">{conflict.conflict_type === 'ambiguous_plate_match' ? 'placa duplicada' : 'vínculo divergente'}</Badge>
            {overdue ? <Badge variant="destructive">SLA 4h vencido</Badge> : <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />SLA 4h</Badge>}
            <span className="text-xs text-muted-foreground">observado {conflict.occurrence_count}x</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Placa informada: {conflict.observed_plate || 'não informada'}
            {conflict.linked_vehicle ? ` · vínculo atual ${conflict.linked_vehicle.plate}` : ''}
          </p>
          <div className="grid gap-2 md:grid-cols-[minmax(180px,260px)_1fr_auto]">
            <Select value={selectedVehicle} onValueChange={(value) => setVehicleByConflict((current) => ({ ...current, [conflict.id]: value }))}>
              <SelectTrigger aria-label={`Veículo para ${conflict.external_code}`}><SelectValue placeholder="Escolha o veículo" /></SelectTrigger>
              <SelectContent>
                {conflict.candidate_vehicles.map((vehicle) => <SelectItem key={vehicle.id} value={vehicle.id}>
                  {vehicle.plate}{vehicle.nickname ? ` · ${vehicle.nickname}` : ''}
                </SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              aria-label={`Motivo da resolução de ${conflict.external_code}`}
              value={reason}
              maxLength={500}
              placeholder="Motivo da decisão (obrigatório)"
              onChange={(event) => setReasonByConflict((current) => ({ ...current, [conflict.id]: event.target.value }))}
            />
            <Button
              type="button"
              disabled={!selectedVehicle || reason.trim().length < 3 || resolveMutation.isPending}
              onClick={() => resolveMutation.mutate({ conflictId: conflict.id, vehicleId: selectedVehicle, reason: reason.trim() })}
            >Resolver vínculo</Button>
          </div>
          {conflict.candidate_vehicles.length === 0 ? <p role="alert" className="text-xs text-destructive">
            Nenhum veículo ativo candidato. Cadastre/corrija o veículo antes de resolver.
          </p> : null}
        </div>;
      })}
    </CardContent>
  </Card>;
}
