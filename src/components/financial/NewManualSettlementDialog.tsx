import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import LoadPicker from './LoadPicker';
import { useCreateManualDriverSettlement, useDriverSettlementFilterOptions } from '@/hooks/useDriverSettlements';

interface Props { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: string) => void; }

export default function NewManualSettlementDialog({ open, onOpenChange, onCreated }: Props) {
  const { data: opts } = useDriverSettlementFilterOptions();
  const drivers = opts?.drivers ?? [];
  const vehicles = opts?.vehicles ?? [];
  const create = useCreateManualDriverSettlement();

  const [driverId, setDriverId] = useState<string>('');
  const [vehicleId, setVehicleId] = useState<string>('__none__');
  const [refDate, setRefDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setDriverId(''); setVehicleId('__none__'); setSelectedIds([]);
      setRefDate(new Date().toISOString().slice(0, 10));
    }
  }, [open]);

  const canSubmit = !!driverId && selectedIds.length > 0 && !create.isPending;

  const submit = async () => {
    const id = await create.mutateAsync({
      driver_id: driverId,
      vehicle_id: vehicleId === '__none__' ? null : vehicleId,
      reference_date: refDate || null,
      load_ids: selectedIds,
    });
    onOpenChange(false);
    onCreated?.(id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>Novo acerto manual</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>Motorista *</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger><SelectValue placeholder="Selecione o motorista" /></SelectTrigger>
              <SelectContent>
                {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Veículo</Label>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— sem veículo —</SelectItem>
                {vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Data de referência</Label>
            <Input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
          </div>
        </div>
        <div className="pt-2">
          <Label>Romaneios disponíveis</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Apenas romaneios que ainda não estão em outro acerto aparecem aqui.
          </p>
          <LoadPicker driverId={driverId || null} selectedIds={selectedIds} onChange={setSelectedIds} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={!canSubmit}>Criar acerto ({selectedIds.length})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}