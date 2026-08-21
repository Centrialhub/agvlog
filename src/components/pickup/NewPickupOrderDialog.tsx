import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useClients } from '@/hooks/useClients';
import { useVehicles } from '@/hooks/useVehicles';
import { useTenant } from '@/hooks/useTenant';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCreatePickupOrder, useUpdatePickupOrder, PickupOrder, PICKUP_STATUSES, PICKUP_STATUS_LABELS } from '@/hooks/usePickupOrders';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (pickup: PickupOrder) => void;
  pickup?: PickupOrder | null;
}

const NONE = '__none__';

export default function NewPickupOrderDialog({ open, onOpenChange, onCreated, pickup }: Props) {
  const { currentTenant } = useTenant();
  const { data: clients = [] } = useClients();
  const { data: vehicles = [] } = useVehicles();
  const { toast } = useToast();
  const createMut = useCreatePickupOrder();
  const updateMut = useUpdatePickupOrder();

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers-pickup', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('drivers')
        .select('id, name, doc, active')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant && open,
  });

  const [remitterClientId, setRemitterClientId] = useState<string>(NONE);
  const [recipientName, setRecipientName] = useState('');
  const [driverId, setDriverId] = useState<string>(NONE);
  const [vehicleId, setVehicleId] = useState<string>(NONE);
  const [pickupAt, setPickupAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [status, setStatus] = useState<typeof PICKUP_STATUSES[number]>('pendente');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      if (pickup) {
        setRemitterClientId(pickup.remitter_client_id || NONE);
        setRecipientName(pickup.recipient_name || '');
        setDriverId(pickup.driver_id || NONE);
        setVehicleId(pickup.vehicle_id || NONE);
        setPickupAt(pickup.pickup_at ? new Date(pickup.pickup_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16));
        setStatus(pickup.status);
        setNotes(pickup.notes || '');
      } else {
        setRemitterClientId(NONE);
        setRecipientName('');
        setDriverId(NONE);
        setVehicleId(NONE);
        setPickupAt(new Date().toISOString().slice(0, 16));
        setStatus('pendente');
        setNotes('');
      }
    }
  }, [open, pickup]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const remitter = clients.find(c => c.id === remitterClientId);
    const driver = drivers.find((d: any) => d.id === driverId);
    const vehicle = vehicles.find(v => v.id === vehicleId);

    if (!driver) {
      toast({ title: 'Motorista obrigatório', variant: 'destructive' });
      return;
    }
    if (!vehicle) {
      toast({ title: 'Veículo obrigatório', variant: 'destructive' });
      return;
    }
    if (!recipientName.trim()) {
      toast({ title: 'Destinatário obrigatório', variant: 'destructive' });
      return;
    }

    const payload: Partial<PickupOrder> = {
      remitter_client_id: remitter?.id || null,
      remitter_name: remitter?.company_name || null,
      remitter_cnpj: remitter?.tax_id || null,
      recipient_name: recipientName.trim(),
      driver_id: driver.id,
      driver_name_snapshot: (driver as any).name,
      vehicle_id: vehicle.id,
      vehicle_plate_snapshot: vehicle.plate,
      pickup_at: new Date(pickupAt).toISOString(),
      status,
      notes: notes.trim() || null,
    };

    try {
      if (pickup) {
        await updateMut.mutateAsync({ id: pickup.id, ...payload });
        toast({ title: 'Coleta atualizada' });
        onOpenChange(false);
      } else {
        const created = await createMut.mutateAsync(payload);
        toast({ title: `Coleta nº ${created.pickup_number} criada` });
        onCreated?.(created);
        onOpenChange(false);
      }
    } catch (err: any) {
      toast({ title: 'Erro ao salvar coleta', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pickup ? `Editar Coleta nº ${pickup.pickup_number}` : 'Nova Coleta'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>Remetente (Fornecedor)</Label>
              <Select value={remitterClientId} onValueChange={setRemitterClientId}>
                <SelectTrigger><SelectValue placeholder="Selecione o fornecedor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— sem remetente cadastrado —</SelectItem>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Destinatário (Unidade nossa que recebe)</Label>
              <Input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Ex: Filial Montes Claros" required />
            </div>
            <div className="space-y-2">
              <Label>Motorista *</Label>
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {drivers.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}{d.doc ? ` • ${d.doc}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Veículo *</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {vehicles.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.plate}{v.nickname ? ` • ${v.nickname}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data/Hora da Coleta *</Label>
              <Input type="datetime-local" value={pickupAt} onChange={e => setPickupAt(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PICKUP_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{PICKUP_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Observações</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>
              {pickup ? 'Salvar' : 'Criar Coleta'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}