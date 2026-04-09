import { useState, useMemo } from 'react';
import { useEmployees, useCreateEmployee, useUpdateEmployee, Employee, EMPLOYEE_STATUSES, EMPLOYEE_STATUS_LABELS } from '@/hooks/useEmployees';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Plus, Users, Edit, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format, differenceInDays, parseISO } from 'date-fns';

export default function Employees() {
  const { data: employees = [], isLoading } = useEmployees();
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | undefined>();

  const [form, setForm] = useState({
    name: '', doc_cpf: '', role_title: '', department: '', branch: '',
    cost_center: '', phone: '', email: '', hire_date: '',
    cnh_number: '', cnh_category: '', cnh_expiry: '', medical_exam_expiry: '',
    status: 'active' as string, notes: '',
  });

  const filtered = useMemo(() => {
    let list = employees;
    if (statusFilter !== 'all') list = list.filter(e => e.status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(s) || e.doc_cpf?.includes(s) || e.role_title?.toLowerCase().includes(s));
    }
    return list;
  }, [employees, search, statusFilter]);

  const expiringDocs = useMemo(() => {
    const now = new Date();
    return employees.filter(e => {
      if (e.cnh_expiry && differenceInDays(parseISO(e.cnh_expiry), now) < 30) return true;
      if (e.medical_exam_expiry && differenceInDays(parseISO(e.medical_exam_expiry), now) < 30) return true;
      return false;
    });
  }, [employees]);

  const openCreate = () => {
    setEditing(undefined);
    setForm({ name: '', doc_cpf: '', role_title: '', department: '', branch: '', cost_center: '', phone: '', email: '', hire_date: '', cnh_number: '', cnh_category: '', cnh_expiry: '', medical_exam_expiry: '', status: 'active', notes: '' });
    setDialogOpen(true);
  };

  const openEdit = (e: Employee) => {
    setEditing(e);
    setForm({
      name: e.name, doc_cpf: e.doc_cpf || '', role_title: e.role_title || '',
      department: e.department || '', branch: e.branch || '', cost_center: e.cost_center || '',
      phone: e.phone || '', email: e.email || '', hire_date: e.hire_date || '',
      cnh_number: e.cnh_number || '', cnh_category: e.cnh_category || '',
      cnh_expiry: e.cnh_expiry || '', medical_exam_expiry: e.medical_exam_expiry || '',
      status: e.status, notes: e.notes || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Nome obrigatório'); return; }
    const payload: any = { ...form };
    Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null; });
    payload.name = form.name;
    payload.status = form.status;
    try {
      if (editing) await updateEmployee.mutateAsync({ id: editing.id, ...payload });
      else await createEmployee.mutateAsync(payload);
      setDialogOpen(false);
      toast.success(editing ? 'Funcionário atualizado' : 'Funcionário cadastrado');
    } catch (e: any) { toast.error(e.message); }
  };

  const statusColor = (s: string) => {
    if (s === 'active') return 'bg-green-500/10 text-green-600';
    if (s === 'on_leave') return 'bg-yellow-500/10 text-yellow-600';
    if (s === 'terminated') return 'bg-red-500/10 text-red-600';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Users className="h-5 w-5" /> Funcionários</h1>
          <p className="text-sm text-muted-foreground">{employees.length} cadastrados</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Novo Funcionário</Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {EMPLOYEE_STATUSES.map(s => (
          <Card key={s}><CardContent className="py-3 px-4">
            <p className="text-[10px] text-muted-foreground uppercase">{EMPLOYEE_STATUS_LABELS[s]}</p>
            <p className="text-lg font-bold">{employees.filter(e => e.status === s).length}</p>
          </CardContent></Card>
        ))}
        <Card className={expiringDocs.length > 0 ? 'border-warning' : ''}><CardContent className="py-3 px-4">
          <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
            {expiringDocs.length > 0 && <AlertTriangle className="h-3 w-3 text-warning" />} Docs Vencendo
          </p>
          <p className="text-lg font-bold">{expiringDocs.length}</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9" placeholder="Buscar nome, CPF, cargo..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {EMPLOYEE_STATUSES.map(s => <SelectItem key={s} value={s}>{EMPLOYEE_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Filial</TableHead>
                <TableHead>Centro Custo</TableHead>
                <TableHead>CNH Validade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Nenhum funcionário encontrado</TableCell></TableRow>
              ) : filtered.map(e => {
                const cnhDays = e.cnh_expiry ? differenceInDays(parseISO(e.cnh_expiry), new Date()) : null;
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium text-sm">{e.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.role_title || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.branch || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.cost_center || '—'}</TableCell>
                    <TableCell>
                      {e.cnh_expiry ? (
                        <Badge variant="outline" className={`text-[10px] ${cnhDays !== null && cnhDays < 30 ? 'bg-warning/10 text-warning' : ''}`}>
                          {format(parseISO(e.cnh_expiry), 'dd/MM/yyyy')}
                        </Badge>
                      ) : '—'}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={`text-[10px] ${statusColor(e.status)}`}>{EMPLOYEE_STATUS_LABELS[e.status]}</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => openEdit(e)}><Edit className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Editar Funcionário' : 'Novo Funcionário'}</DialogTitle></DialogHeader>
          <Tabs defaultValue="dados">
            <TabsList className="w-full"><TabsTrigger value="dados">Dados</TabsTrigger><TabsTrigger value="docs">Documentos</TabsTrigger><TabsTrigger value="obs">Observações</TabsTrigger></TabsList>
            <TabsContent value="dados" className="space-y-3 mt-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div><Label className="text-xs">CPF</Label><Input value={form.doc_cpf} onChange={e => setForm(f => ({ ...f, doc_cpf: e.target.value }))} /></div>
                <div><Label className="text-xs">Cargo/Função</Label><Input value={form.role_title} onChange={e => setForm(f => ({ ...f, role_title: e.target.value }))} /></div>
                <div><Label className="text-xs">Departamento</Label><Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} /></div>
                <div><Label className="text-xs">Filial/Base</Label><Input value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))} /></div>
                <div><Label className="text-xs">Centro de Custo</Label><Input value={form.cost_center} onChange={e => setForm(f => ({ ...f, cost_center: e.target.value }))} /></div>
                <div><Label className="text-xs">Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
                <div><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
                <div><Label className="text-xs">Data Admissão</Label><Input type="date" value={form.hire_date} onChange={e => setForm(f => ({ ...f, hire_date: e.target.value }))} /></div>
                <div><Label className="text-xs">Status</Label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{EMPLOYEE_STATUSES.map(s => <SelectItem key={s} value={s}>{EMPLOYEE_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="docs" className="space-y-3 mt-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Nº CNH</Label><Input value={form.cnh_number} onChange={e => setForm(f => ({ ...f, cnh_number: e.target.value }))} /></div>
                <div><Label className="text-xs">Categoria CNH</Label><Input value={form.cnh_category} onChange={e => setForm(f => ({ ...f, cnh_category: e.target.value }))} placeholder="A, B, C, D, E" /></div>
                <div><Label className="text-xs">Validade CNH</Label><Input type="date" value={form.cnh_expiry} onChange={e => setForm(f => ({ ...f, cnh_expiry: e.target.value }))} /></div>
                <div><Label className="text-xs">Validade Exame Médico</Label><Input type="date" value={form.medical_exam_expiry} onChange={e => setForm(f => ({ ...f, medical_exam_expiry: e.target.value }))} /></div>
              </div>
            </TabsContent>
            <TabsContent value="obs" className="mt-3">
              <Textarea rows={4} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Observações..." />
            </TabsContent>
          </Tabs>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createEmployee.isPending || updateEmployee.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
