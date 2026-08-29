import { useState, useMemo } from 'react';
import { useMaintenanceOrders, useCreateMaintenanceOrder, useUpdateMaintenanceOrder, MaintenanceOrder, MAINT_TYPES, MAINT_TYPE_LABELS, MAINT_STATUSES, MAINT_STATUS_LABELS } from '@/hooks/useMaintenanceOrders';
import { useVehicles } from '@/hooks/useVehicles';
import { useEmployees } from '@/hooks/useEmployees';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, Wrench, Edit } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { getErrorMessage } from '@/lib/errors';

export default function MaintenanceOrdersPage() {
  const { data: orders = [], isLoading } = useMaintenanceOrders();
  const { data: vehicles = [] } = useVehicles();
  const { data: employees = [] } = useEmployees();
  const createOrder = useCreateMaintenanceOrder();
  const updateOrder = useUpdateMaintenanceOrder();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceOrder | undefined>();

  const [form, setForm] = useState({
    vehicle_id: '', maintenance_type: 'corrective' as string, priority: 'medium',
    reported_problem: '', diagnosis: '', supplier_vendor: '',
    responsible_employee_id: '', odometer_km: '', parts_cost: '', labor_cost: '',
    services_performed: '', notes: '', status: 'open' as string,
  });

  const filtered = useMemo(() => {
    let list = orders;
    if (statusFilter !== 'all') list = list.filter(o => o.status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(o => o.order_number.toLowerCase().includes(s) || o.reported_problem?.toLowerCase().includes(s) || o.vehicles?.plate?.toLowerCase().includes(s));
    }
    return list;
  }, [orders, search, statusFilter]);

  const openCreate = () => {
    setEditing(undefined);
    setForm({ vehicle_id: '', maintenance_type: 'corrective', priority: 'medium', reported_problem: '', diagnosis: '', supplier_vendor: '', responsible_employee_id: '', odometer_km: '', parts_cost: '', labor_cost: '', services_performed: '', notes: '', status: 'open' });
    setDialogOpen(true);
  };

  const openEdit = (o: MaintenanceOrder) => {
    setEditing(o);
    setForm({
      vehicle_id: o.vehicle_id || '', maintenance_type: o.maintenance_type, priority: o.priority,
      reported_problem: o.reported_problem || '', diagnosis: o.diagnosis || '',
      supplier_vendor: o.supplier_vendor || '', responsible_employee_id: o.responsible_employee_id || '',
      odometer_km: String(o.odometer_km || ''), parts_cost: String(o.parts_cost || ''),
      labor_cost: String(o.labor_cost || ''), services_performed: o.services_performed || '',
      notes: o.notes || '', status: o.status,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      vehicle_id: form.vehicle_id || null,
      maintenance_type: form.maintenance_type,
      priority: form.priority,
      reported_problem: form.reported_problem || null,
      diagnosis: form.diagnosis || null,
      supplier_vendor: form.supplier_vendor || null,
      responsible_employee_id: form.responsible_employee_id || null,
      odometer_km: form.odometer_km ? Number(form.odometer_km) : null,
      parts_cost: form.parts_cost ? Number(form.parts_cost) : 0,
      labor_cost: form.labor_cost ? Number(form.labor_cost) : 0,
      total_cost: (Number(form.parts_cost) || 0) + (Number(form.labor_cost) || 0),
      services_performed: form.services_performed || null,
      notes: form.notes || null,
      status: form.status,
      completed_at: form.status === 'completed' && !editing?.completed_at
        ? new Date().toISOString()
        : editing?.completed_at ?? null,
    };
    try {
      if (editing) await updateOrder.mutateAsync({ id: editing.id, ...payload });
      else await createOrder.mutateAsync(payload);
      setDialogOpen(false);
      toast.success(editing ? 'OS atualizada' : 'OS criada');
    } catch (error) { toast.error(getErrorMessage(error, 'Não foi possível salvar a ordem de manutenção.')); }
  };

  const kpis = useMemo(() => ({
    open: orders.filter(o => !['completed','cancelled'].includes(o.status)).length,
    totalCost: orders.reduce((s, o) => s + (o.total_cost || 0), 0),
    downtime: orders.reduce((s, o) => s + (o.downtime_hours || 0), 0),
  }), [orders]);

  const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Wrench className="h-5 w-5" /> Ordens de Manutenção</h1>
          <p className="text-sm text-muted-foreground">{orders.length} ordens</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nova OS</Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Em Aberto</p><p className="text-lg font-bold">{kpis.open}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Custo Total</p><p className="text-lg font-bold">{fmt(kpis.totalCost)}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Horas Parado</p><p className="text-lg font-bold">{kpis.downtime.toFixed(1)}h</p></CardContent></Card>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8 h-9" placeholder="Buscar OS, placa..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos Status</SelectItem>{MAINT_STATUSES.map(s => <SelectItem key={s} value={s}>{MAINT_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card><CardContent className="p-0">
        <Table><TableHeader><TableRow>
          <TableHead>OS</TableHead><TableHead>Veículo</TableHead><TableHead>Tipo</TableHead>
          <TableHead>Problema</TableHead><TableHead>Custo</TableHead><TableHead>Status</TableHead><TableHead className="w-10"></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {isLoading ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
          : filtered.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhuma OS</TableCell></TableRow>
          : filtered.map(o => (
            <TableRow key={o.id}>
              <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
              <TableCell className="text-sm font-medium">{o.vehicles?.plate || '—'}</TableCell>
              <TableCell className="text-sm">{MAINT_TYPE_LABELS[o.maintenance_type]}</TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{o.reported_problem || '—'}</TableCell>
              <TableCell className="text-sm">{fmt(o.total_cost ?? 0)}</TableCell>
              <TableCell><Badge variant="outline" className="text-[10px]">{MAINT_STATUS_LABELS[o.status]}</Badge></TableCell>
              <TableCell><Button variant="ghost" size="icon" onClick={() => openEdit(o)}><Edit className="h-4 w-4" /></Button></TableCell>
            </TableRow>
          ))}
        </TableBody></Table>
      </CardContent></Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Editar ${editing.order_number}` : 'Nova OS'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Veículo</Label>
              <Select value={form.vehicle_id} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.plate} {v.nickname ? `(${v.nickname})` : ''}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Tipo</Label>
              <Select value={form.maintenance_type} onValueChange={v => setForm(f => ({ ...f, maintenance_type: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MAINT_TYPES.map(t => <SelectItem key={t} value={t}>{MAINT_TYPE_LABELS[t]}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Prioridade</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="low">Baixa</SelectItem><SelectItem value="medium">Média</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="critical">Crítica</SelectItem></SelectContent></Select>
            </div>
            <div><Label className="text-xs">Odômetro (km)</Label><Input type="number" value={form.odometer_km} onChange={e => setForm(f => ({ ...f, odometer_km: e.target.value }))} /></div>
            <div><Label className="text-xs">Responsável</Label>
              <Select value={form.responsible_employee_id} onValueChange={v => setForm(f => ({ ...f, responsible_employee_id: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Fornecedor/Oficina</Label><Input value={form.supplier_vendor} onChange={e => setForm(f => ({ ...f, supplier_vendor: e.target.value }))} /></div>
            <div><Label className="text-xs">Custo Peças (R$)</Label><Input type="number" step="0.01" value={form.parts_cost} onChange={e => setForm(f => ({ ...f, parts_cost: e.target.value }))} /></div>
            <div><Label className="text-xs">Custo Mão de Obra (R$)</Label><Input type="number" step="0.01" value={form.labor_cost} onChange={e => setForm(f => ({ ...f, labor_cost: e.target.value }))} /></div>
            {editing && <div><Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MAINT_STATUSES.map(s => <SelectItem key={s} value={s}>{MAINT_STATUS_LABELS[s]}</SelectItem>)}</SelectContent></Select>
            </div>}
          </div>
          <div><Label className="text-xs">Problema Relatado</Label><Textarea rows={2} value={form.reported_problem} onChange={e => setForm(f => ({ ...f, reported_problem: e.target.value }))} /></div>
          <div><Label className="text-xs">Diagnóstico</Label><Textarea rows={2} value={form.diagnosis} onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))} /></div>
          <div><Label className="text-xs">Serviços Executados</Label><Textarea rows={2} value={form.services_performed} onChange={e => setForm(f => ({ ...f, services_performed: e.target.value }))} /></div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createOrder.isPending || updateOrder.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
