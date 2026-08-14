import { useState } from 'react';
import {
  useVehicleMaintenanceList,
  useCreateMaintenance,
  useUpdateMaintenance,
  VehicleMaintenance,
} from '@/hooks/useFleetManagement';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Wrench, AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { format, isPast, addDays } from 'date-fns';

const MAINT_TYPES = [
  { value: 'preventive', label: 'Preventiva' },
  { value: 'corrective', label: 'Corretiva' },
  { value: 'inspection', label: 'Inspeção' },
];

const CATEGORIES = [
  { value: 'oil_change', label: 'Troca de Óleo' },
  { value: 'tires', label: 'Pneus' },
  { value: 'brakes', label: 'Freios' },
  { value: 'engine', label: 'Motor' },
  { value: 'electrical', label: 'Elétrica' },
  { value: 'bodywork', label: 'Carroceria' },
  { value: 'general', label: 'Geral' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  scheduled: { label: 'Agendada', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20', icon: <Clock className="h-3 w-3" /> },
  in_progress: { label: 'Em Andamento', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20', icon: <Wrench className="h-3 w-3" /> },
  completed: { label: 'Concluída', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', icon: <CheckCircle2 className="h-3 w-3" /> },
  cancelled: { label: 'Cancelada', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: <XCircle className="h-3 w-3" /> },
};

interface Props {
  vehicleId: string;
  currentOdometer?: number | null;
}

export default function MaintenanceTab({ vehicleId, currentOdometer }: Props) {
  const { data: items = [], isLoading } = useVehicleMaintenanceList(vehicleId);
  const createMut = useCreateMaintenance();
  const updateMut = useUpdateMaintenance();
  const [dialogOpen, setDialogOpen] = useState(false);

  const [form, setForm] = useState({
    maintenance_type: 'preventive',
    category: 'general',
    description: '',
    scheduled_date: '',
    odometer_at_service: '',
    next_odometer: '',
    next_date: '',
    cost: '',
    vendor: '',
    notes: '',
  });

  const overdue = items.filter(m =>
    m.status === 'scheduled' && (
      (m.scheduled_date && isPast(new Date(m.scheduled_date + 'T23:59:59'))) ||
      (m.next_odometer && currentOdometer && currentOdometer >= m.next_odometer)
    )
  );

  const upcoming = items.filter(m =>
    m.status === 'scheduled' && !overdue.find(o => o.id === m.id) &&
    m.scheduled_date && !isPast(addDays(new Date(m.scheduled_date + 'T23:59:59'), -7))
  );

  const handleSave = async () => {
    try {
      await createMut.mutateAsync({
        vehicle_id: vehicleId,
        maintenance_type: form.maintenance_type,
        category: form.category,
        description: form.description,
        scheduled_date: form.scheduled_date || null,
        odometer_at_service: form.odometer_at_service ? Number(form.odometer_at_service) : null,
        next_odometer: form.next_odometer ? Number(form.next_odometer) : null,
        next_date: form.next_date || null,
        cost: form.cost ? Number(form.cost) : null,
        vendor: form.vendor || null,
        notes: form.notes || null,
      } as any);
      toast.success('Manutenção registrada');
      setDialogOpen(false);
      setForm({ maintenance_type: 'preventive', category: 'general', description: '', scheduled_date: '', odometer_at_service: '', next_odometer: '', next_date: '', cost: '', vendor: '', notes: '' });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      const updates: any = { status };
      if (status === 'completed') updates.completed_date = new Date().toISOString().slice(0, 10);
      await updateMut.mutateAsync({ id, ...updates });
      toast.success('Status atualizado');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* Alert cards */}
      {(overdue.length > 0 || upcoming.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {overdue.length > 0 && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                <div>
                  <p className="text-sm font-medium text-destructive">{overdue.length} manutenção(ões) atrasada(s)</p>
                  <p className="text-xs text-muted-foreground">{overdue.map(m => CATEGORIES.find(c => c.value === m.category)?.label || m.category).join(', ')}</p>
                </div>
              </CardContent>
            </Card>
          )}
          {upcoming.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-4 flex items-center gap-3">
                <Clock className="h-5 w-5 text-amber-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-600">{upcoming.length} manutenção(ões) próxima(s)</p>
                  <p className="text-xs text-muted-foreground">Nos próximos 7 dias</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-foreground">Histórico de Manutenção</h3>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nova Manutenção
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Km</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhuma manutenção registrada</TableCell></TableRow>
              ) : items.map(m => {
                const st = STATUS_CONFIG[m.status] || STATUS_CONFIG.scheduled;
                const isOverdue = overdue.find(o => o.id === m.id);
                return (
                  <TableRow key={m.id} className={isOverdue ? 'bg-destructive/5' : ''}>
                    <TableCell className="text-sm">{MAINT_TYPES.find(t => t.value === m.maintenance_type)?.label || m.maintenance_type}</TableCell>
                    <TableCell className="text-sm">{CATEGORIES.find(c => c.value === m.category)?.label || m.category}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{m.description || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.completed_date ? format(new Date(m.completed_date + 'T12:00:00'), 'dd/MM/yyyy') :
                       m.scheduled_date ? format(new Date(m.scheduled_date + 'T12:00:00'), 'dd/MM/yyyy') : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono">{m.odometer_at_service ? `${Number(m.odometer_at_service).toLocaleString('pt-BR')}` : '—'}</TableCell>
                    <TableCell className="text-sm text-right">{m.cost ? `R$ ${Number(m.cost).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`gap-1 ${st.color}`}>
                        {st.icon} {st.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {m.status !== 'completed' && m.status !== 'cancelled' && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-emerald-600" onClick={() => handleStatusChange(m.id, 'completed')}>
                            <CheckCircle2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add maintenance dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nova Manutenção</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tipo</Label>
                <Select value={form.maintenance_type} onValueChange={v => setForm(f => ({ ...f, maintenance_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MAINT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Ex: Troca de óleo 15W40 + filtros" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Data Agendada/Realizada</Label><Input type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} /></div>
              <div><Label>Km no Serviço</Label><Input type="number" value={form.odometer_at_service} onChange={e => setForm(f => ({ ...f, odometer_at_service: e.target.value }))} placeholder={currentOdometer ? `Atual: ~${Math.round(currentOdometer).toLocaleString()}` : ''} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Próxima em (km)</Label><Input type="number" value={form.next_odometer} onChange={e => setForm(f => ({ ...f, next_odometer: e.target.value }))} placeholder="Ex: 150000" /></div>
              <div><Label>Próxima em (data)</Label><Input type="date" value={form.next_date} onChange={e => setForm(f => ({ ...f, next_date: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Custo (R$)</Label><Input type="number" step="0.01" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} /></div>
              <div><Label>Fornecedor</Label><Input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} /></div>
            </div>
            <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={createMut.isPending}>Salvar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
