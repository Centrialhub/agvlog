import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import LoadPicker from './LoadPicker';
import { useCreateManualDriverSettlement, useDriverSettlementFilterOptions } from '@/hooks/useDriverSettlements';
import { localDateInputValue } from '@/lib/utils/formatDate';

interface Props { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: string) => void; }

export default function NewManualSettlementDialog({ open, onOpenChange, onCreated }: Props) {
  const [driverSearch,setDriverSearch]=useState(''),[vehicleSearch,setVehicleSearch]=useState(''),[driverPage,setDriverPage]=useState(1),[vehiclePage,setVehiclePage]=useState(1);
  const driverOptions=useDriverSettlementFilterOptions('drivers',driverSearch,driverPage),vehicleOptions=useDriverSettlementFilterOptions('vehicles',vehicleSearch,vehiclePage);
  const drivers = driverOptions.data?.rows ?? [];
  const vehicles = vehicleOptions.data?.rows ?? [];
  const create = useCreateManualDriverSettlement();

  const [driverId, setDriverId] = useState<string>('');
  const [vehicleId, setVehicleId] = useState<string>('__none__');
  const [refDate, setRefDate] = useState<string>(() => localDateInputValue());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [availableLoads, setAvailableLoads] = useState<Array<{ id: string; driver_id: string | null; driver_name: string | null }>>([]);

  useEffect(() => {
    if (open) {
      setDriverId(''); setVehicleId('__none__'); setSelectedIds([]);setDriverSearch('');setVehicleSearch('');setDriverPage(1);setVehiclePage(1);
      setRefDate(localDateInputValue());
      setAvailableLoads([]);
    }
  }, [open]);

  // Infer driver from selection when the user hasn't picked one yet.
  const selectedLoads = useMemo(
    () => availableLoads.filter(l => selectedIds.includes(l.id)),
    [availableLoads, selectedIds],
  );
  const selectedDriverIds = useMemo(
    () => Array.from(new Set(selectedLoads.map(l => l.driver_id).filter((v): v is string => !!v))),
    [selectedLoads],
  );
  useEffect(() => {
    if (!driverId && selectedDriverIds.length === 1) {
      setDriverId(selectedDriverIds[0]);
    }
  }, [selectedDriverIds, driverId]);

  const mixedDrivers = selectedDriverIds.length > 1;
  const canSubmit = !!driverId && selectedIds.length > 0 && !mixedDrivers && !create.isPending;
  const disabledReason = !driverId && selectedIds.length === 0
    ? 'Selecione motorista e ao menos um romaneio'
    : !driverId
      ? 'Selecione o motorista'
      : selectedIds.length === 0
        ? 'Selecione ao menos um romaneio'
        : mixedDrivers
          ? 'Romaneios de motoristas diferentes'
          : '';

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
      <DialogContent className="max-w-[95vw] md:max-w-5xl max-h-[95vh] overflow-y-auto flex flex-col p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>Novo acerto manual</DialogTitle>
          <DialogDescription>Crie um acerto financeiro manual para o motorista selecionado.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-5">
            <Label>Motorista *</Label>
            <Input aria-label="Buscar motorista do novo acerto" placeholder="Buscar motorista" value={driverSearch} onChange={e=>{setDriverSearch(e.target.value);setDriverPage(1);}} />
            <Select value={driverId} onValueChange={value => { setDriverId(value); setSelectedIds([]); setAvailableLoads([]); }}>
              <SelectTrigger><SelectValue placeholder="Selecione o motorista" /></SelectTrigger>
              <SelectContent>
                {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-1"><Button type="button" size="sm" variant="outline" disabled={driverPage===1} onClick={()=>setDriverPage(p=>p-1)}>Anteriores</Button><Button type="button" size="sm" variant="outline" disabled={!driverOptions.data||driverPage*50>=driverOptions.data.total} onClick={()=>setDriverPage(p=>p+1)}>Mais</Button></div>
          </div>
          <div className="md:col-span-4">
            <Label>Veículo</Label>
            <Input aria-label="Buscar veículo do novo acerto" placeholder="Buscar placa" value={vehicleSearch} onChange={e=>{setVehicleSearch(e.target.value);setVehiclePage(1);}} />
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— sem veículo —</SelectItem>
                {vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-1"><Button type="button" size="sm" variant="outline" disabled={vehiclePage===1} onClick={()=>setVehiclePage(p=>p-1)}>Anteriores</Button><Button type="button" size="sm" variant="outline" disabled={!vehicleOptions.data||vehiclePage*50>=vehicleOptions.data.total} onClick={()=>setVehiclePage(p=>p+1)}>Mais</Button></div>
          </div>
          <div className="md:col-span-3">
            <Label>Data de referência</Label>
            <Input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
          </div>
        </div>
        <div className="pt-2">
          <Label>Romaneios disponíveis</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Apenas romaneios que ainda não estão em outro acerto aparecem aqui.
          </p>
          <LoadPicker
            driverId={driverId || null}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
            onLoadsChange={setAvailableLoads}
            lockedDriverId={driverId || null}
          />
          {mixedDrivers && (
            <div className="mt-2 text-xs rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-1.5">
              Romaneios selecionados pertencem a motoristas diferentes. Selecione romaneios de um único motorista.
            </div>
          )}
        </div>
      </div>
        <DialogFooter className="p-6 pt-2 border-t bg-muted/5">
          <div className="flex items-center gap-3 flex-1">
            {disabledReason && (
              <span className="text-xs text-muted-foreground">{disabledReason}</span>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={!canSubmit} title={disabledReason || undefined}>
            Criar acerto ({selectedIds.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
