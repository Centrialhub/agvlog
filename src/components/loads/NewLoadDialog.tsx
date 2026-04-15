import { useState } from 'react';
import { useCreateLoad } from '@/hooks/useLoads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  vehicles: any[];
  drivers: any[];
  onCreated: () => void;
}

export default function NewLoadDialog({ vehicles, drivers, onCreated }: Props) {
  const createLoad = useCreateLoad();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ load_number: '', vehicle_id: '', driver_id: '', origin: '', destination: '', notes: '' });

  const handleSave = async () => {
    try {
      await createLoad.mutateAsync({
        ...form,
        vehicle_id: form.vehicle_id || null,
        driver_id: form.driver_id || null,
        status: 'planned',
      } as any);
      toast({ title: 'Carga criada' });
      setOpen(false);
      setForm({ load_number: '', vehicle_id: '', driver_id: '', origin: '', destination: '', notes: '' });
      onCreated();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Carga</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nova Carga</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Nº Carga *</Label><Input value={form.load_number} onChange={e => setForm(f => ({ ...f, load_number: e.target.value }))} placeholder="CG-001" /></div>
            <div>
              <Label className="text-xs">Veículo</Label>
              <Select value={form.vehicle_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Motorista</Label>
              <Select value={form.driver_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, driver_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {drivers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Destino</Label><Input value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} /></div>
          </div>
          <div><Label className="text-xs">Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!form.load_number.trim() || createLoad.isPending}>Criar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
