import { useState, useMemo } from 'react';
import {
  useIncidents, useCreateIncident, useUpdateIncident, Incident,
  INCIDENT_TYPES, INCIDENT_TYPE_LABELS, INCIDENT_STATUSES, INCIDENT_STATUS_LABELS,
  SEVERITY_LABELS, INCIDENT_SEVERITIES,
  INCIDENT_CATEGORIES, INCIDENT_CATEGORY_LABELS,
  INCIDENT_ACTION_TYPES, INCIDENT_ACTION_LABELS,
  useIncidentActions, useAddEmployeeIncidentAction,
} from '@/hooks/useIncidents';
import { useEmployees } from '@/hooks/useEmployees';
import { useVehicles } from '@/hooks/useVehicles';
import { useClients } from '@/hooks/useClients';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, AlertOctagon, Edit } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { Separator } from '@/components/ui/separator';

export default function Incidents() {
  const { data: incidents = [], isLoading } = useIncidents();
  const { data: employees = [] } = useEmployees();
  const { data: vehicles = [] } = useVehicles();
  const { data: clients = [] } = useClients();
  const createIncident = useCreateIncident();
  const updateIncident = useUpdateIncident();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Incident | undefined>();

  const [form, setForm] = useState({
    title: '', incident_type: 'other' as string, category: 'operational',
    severity: 'medium' as string, description: '', employee_id: '', vehicle_id: '', client_id: '',
    estimated_cost: '', action_plan: '', conclusion: '', status: 'open' as string,
  });

  const filtered = useMemo(() => {
    let list = incidents;
    if (statusFilter !== 'all') list = list.filter(i => i.status === statusFilter);
    if (severityFilter !== 'all') list = list.filter(i => i.severity === severityFilter);
    if (categoryFilter !== 'all') {
      list = list.filter(i => (i.category || 'operational') === categoryFilter
        || (categoryFilter === 'hr' && i.category === 'rh'));
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(s) || i.incident_number.toLowerCase().includes(s));
    }
    return list;
  }, [incidents, search, statusFilter, severityFilter, categoryFilter]);

  const openCreate = () => {
    setEditing(undefined);
    setForm({ title: '', incident_type: 'other', category: 'operational', severity: 'medium', description: '', employee_id: '', vehicle_id: '', client_id: '', estimated_cost: '', action_plan: '', conclusion: '', status: 'open' });
    setDialogOpen(true);
  };

  const openEdit = (i: Incident) => {
    setEditing(i);
    setForm({
      title: i.title, incident_type: i.incident_type, category: i.category === 'rh' ? 'hr' : (i.category || 'operational'),
      severity: i.severity, description: i.description || '', employee_id: i.employee_id || '',
      vehicle_id: i.vehicle_id || '', client_id: i.client_id || '',
      estimated_cost: String(i.estimated_cost || ''), action_plan: i.action_plan || '',
      conclusion: i.conclusion || '', status: i.status,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error('Título obrigatório'); return; }
    if (form.category === 'hr' && !form.employee_id) {
      toast.error('Ocorrência de RH exige um funcionário vinculado'); return;
    }
    // Critical incidents need responsible + conclusion to close
    if (['resolved','closed'].includes(form.status) && ['high','critical'].includes(form.severity) && !form.conclusion.trim()) {
      toast.error('Ocorrências críticas precisam de conclusão/parecer final para encerrar');
      return;
    }
    const payload: any = { ...form, estimated_cost: form.estimated_cost ? Number(form.estimated_cost) : 0 };
    ['employee_id','vehicle_id','client_id'].forEach(k => { if (!payload[k]) payload[k] = null; });
    if (['resolved','closed'].includes(form.status) && !editing?.resolved_at) payload.resolved_at = new Date().toISOString();
    if (form.status === 'closed' && !editing?.closed_at) payload.closed_at = new Date().toISOString();
    try {
      if (editing) await updateIncident.mutateAsync({ id: editing.id, ...payload });
      else {
        const created = await createIncident.mutateAsync(payload);
        toast.success('Ocorrência registrada');
        // Para ocorrências de RH, manter o modal aberto para permitir cadastrar
        // ações de RH imediatamente sem reabrir a tela.
        if (form.category === 'hr' && created) {
          setEditing(created as Incident);
          setForm(f => ({ ...f, status: (created as Incident).status || f.status }));
          return;
        }
        setDialogOpen(false);
        return;
      }
      setDialogOpen(false);
      toast.success('Ocorrência atualizada');
    } catch (e: any) { toast.error(e.message); }
  };

  const severityColor = (s: string) => {
    if (s === 'critical') return 'bg-red-500/10 text-red-600';
    if (s === 'high') return 'bg-orange-500/10 text-orange-600';
    if (s === 'medium') return 'bg-yellow-500/10 text-yellow-600';
    return 'bg-muted text-muted-foreground';
  };

  const kpis = useMemo(() => ({
    open: incidents.filter(i => ['open','investigating','action_plan'].includes(i.status)).length,
    critical: incidents.filter(i => i.severity === 'critical' && i.status !== 'closed').length,
    totalCost: incidents.reduce((s, i) => s + (i.actual_cost || i.estimated_cost || 0), 0),
  }), [incidents]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><AlertOctagon className="h-5 w-5" /> Ocorrências</h1>
          <p className="text-sm text-muted-foreground">{incidents.length} registradas</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nova Ocorrência</Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Abertas</p><p className="text-lg font-bold">{kpis.open}</p></CardContent></Card>
        <Card className={kpis.critical > 0 ? 'border-destructive' : ''}><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Críticas Ativas</p><p className="text-lg font-bold text-destructive">{kpis.critical}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Custo Acumulado</p><p className="text-lg font-bold">R$ {kpis.totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></CardContent></Card>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos Status</SelectItem>{INCIDENT_STATUSES.map(s => <SelectItem key={s} value={s}>{INCIDENT_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Gravidade</SelectItem>{INCIDENT_SEVERITIES.map(s => <SelectItem key={s} value={s}>{SEVERITY_LABELS[s]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Categoria</SelectItem>
            {INCIDENT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{INCIDENT_CATEGORY_LABELS[c]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nº</TableHead><TableHead>Título</TableHead><TableHead>Categoria</TableHead><TableHead>Tipo</TableHead>
            <TableHead>Gravidade</TableHead><TableHead>Funcionário</TableHead><TableHead>Custo</TableHead>
            <TableHead>Status</TableHead><TableHead className="w-10"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
            : filtered.length === 0 ? <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nenhuma ocorrência</TableCell></TableRow>
            : filtered.map(i => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-xs">{i.incident_number}</TableCell>
                <TableCell className="font-medium text-sm max-w-[200px] truncate">{i.title}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="text-[10px]">
                    {INCIDENT_CATEGORY_LABELS[i.category === 'rh' ? 'hr' : (i.category || 'operational')] || i.category}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{INCIDENT_TYPE_LABELS[i.incident_type] || i.incident_type}</TableCell>
                <TableCell><Badge variant="outline" className={`text-[10px] ${severityColor(i.severity)}`}>{SEVERITY_LABELS[i.severity]}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{i.employees?.name || '—'}</TableCell>
                <TableCell className="text-sm">R$ {(i.estimated_cost || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{INCIDENT_STATUS_LABELS[i.status]}</Badge></TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => openEdit(i)}><Edit className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Editar ${editing.incident_number}` : 'Nova Ocorrência'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label className="text-xs">Título *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
              <div><Label className="text-xs">Categoria</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{INCIDENT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{INCIDENT_CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Tipo</Label>
                <Select value={form.incident_type} onValueChange={v => setForm(f => ({ ...f, incident_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{INCIDENT_TYPES.map(t => <SelectItem key={t} value={t}>{INCIDENT_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Gravidade</Label>
                <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{INCIDENT_SEVERITIES.map(s => <SelectItem key={s} value={s}>{SEVERITY_LABELS[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className={form.category === 'hr' ? 'col-span-2' : ''}><Label className="text-xs">Funcionário {form.category === 'hr' && <span className="text-destructive">*</span>}</Label>
                <Select value={form.employee_id} onValueChange={v => setForm(f => ({ ...f, employee_id: v }))}>
                  <SelectTrigger className={form.category === 'hr' && !form.employee_id ? 'border-destructive' : ''}><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Veículo</Label>
                <Select value={form.vehicle_id} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Cliente</Label>
                <Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Custo Estimado (R$)</Label><Input type="number" step="0.01" value={form.estimated_cost} onChange={e => setForm(f => ({ ...f, estimated_cost: e.target.value }))} /></div>
              {editing && (
                <div><Label className="text-xs">Status</Label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{INCIDENT_STATUSES.map(s => <SelectItem key={s} value={s}>{INCIDENT_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div><Label className="text-xs">Descrição</Label><Textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div><Label className="text-xs">Plano de Ação</Label><Textarea rows={2} value={form.action_plan} onChange={e => setForm(f => ({ ...f, action_plan: e.target.value }))} /></div>
            <div><Label className="text-xs">Conclusão / Parecer Final</Label><Textarea rows={2} value={form.conclusion} onChange={e => setForm(f => ({ ...f, conclusion: e.target.value }))} /></div>
            {editing && form.category === 'hr' && (
              <HrActionsSection incidentId={editing.id} defaultEmployeeId={form.employee_id} savedEmployeeId={editing.employee_id || undefined} />
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createIncident.isPending || updateIncident.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HrActionsSection({ incidentId, defaultEmployeeId }: { incidentId: string; defaultEmployeeId?: string }) {
  const { data: actions = [] } = useIncidentActions(incidentId);
  const addAction = useAddEmployeeIncidentAction();
  const [actionType, setActionType] = useState<string>('note');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');

  const handleAdd = async () => {
    if (!defaultEmployeeId) { toast.error('Vincule um funcionário à ocorrência antes'); return; }
    if (actionType === 'payroll_discount' && !(Number(amount) > 0)) {
      toast.error('Desconto em folha requer valor maior que zero'); return;
    }
    if (actionType === 'payroll_discount' && !effectiveDate) {
      toast.error('Desconto em folha requer data efetiva'); return;
    }
    try {
      await addAction.mutateAsync({
        incident_id: incidentId,
        employee_id: defaultEmployeeId,
        action_type: actionType,
        description: description || null,
        amount: amount ? Number(amount) : 0,
        effective_date: effectiveDate || null,
      });
      toast.success('Ação de RH registrada');
      setDescription(''); setAmount(''); setEffectiveDate(''); setActionType('note');
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="border rounded-md p-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Ações de RH</p>
        <Badge variant="outline" className="text-[10px]">{actions.length}</Badge>
      </div>
      <Separator />
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">Tipo de ação</Label>
          <Select value={actionType} onValueChange={setActionType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{INCIDENT_ACTION_TYPES.map(t => <SelectItem key={t} value={t}>{INCIDENT_ACTION_LABELS[t]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Data efetiva {actionType === 'payroll_discount' && <span className="text-destructive">*</span>}</Label>
          <Input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
        </div>
        <div className="col-span-2"><Label className="text-xs">Descrição</Label>
          <Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        {actionType === 'payroll_discount' && (
          <div><Label className="text-xs">Valor do desconto (R$) *</Label>
            <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={handleAdd} disabled={addAction.isPending}>
          <Plus className="h-3 w-3 mr-1" /> Adicionar ação
        </Button>
      </div>
      {actions.length > 0 && (
        <div className="space-y-1 pt-2">
          {actions.map(a => (
            <div key={a.id} className="flex items-center justify-between text-xs border rounded px-2 py-1 bg-background">
              <div className="flex-1">
                <span className="font-medium">{INCIDENT_ACTION_LABELS[a.action_type] || a.action_type}</span>
                {a.description && <span className="text-muted-foreground"> — {a.description}</span>}
                {a.effective_date && <span className="text-muted-foreground"> · {a.effective_date}</span>}
              </div>
              <div className="flex items-center gap-2">
                {a.action_type === 'payroll_discount' && (
                  <span className="font-mono text-destructive">R$ {Number(a.amount).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
                )}
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    a.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600' :
                    a.status === 'cancelled' ? 'bg-muted text-muted-foreground' :
                    'bg-yellow-500/10 text-yellow-700'
                  }`}
                >
                  {a.status === 'completed' ? 'Concluída' : a.status === 'cancelled' ? 'Cancelada' : 'Aberta'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
