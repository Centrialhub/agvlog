import { useState, useMemo } from 'react';
import { useEmployees, useEmployeesArray, useCreateEmployee, useUpdateEmployee, Employee, EMPLOYEE_STATUSES, EMPLOYEE_STATUS_LABELS } from '@/hooks/useEmployees';
import { FeatureFlagGate } from '@/components/FeatureFlagGate';

import {
  useEmployeeContracts, useCreateEmployeeContract, useUpdateEmployeeContract,
  useEmployeeAdvances, useEmployeeIncidentActions,
  CONTRACT_TYPES, CONTRACT_TYPE_LABELS, EMPLOYMENT_REGIMES, EMPLOYMENT_REGIME_LABELS,
  PAYMENT_CYCLES, PAYMENT_CYCLE_LABELS, ADVANCE_STATUS_LABELS,
} from '@/hooks/usePayroll';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import { Search, Plus, Users, Edit, AlertTriangle, Eye } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { format, differenceInDays, parseISO } from 'date-fns';

export default function Employees() {
  const { data: employees = [], isLoading } = useEmployeesArray();
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | undefined>();
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);

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
    <FeatureFlagGate feature="LOGISTICS_CONSOLIDATION_V2">
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
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setDetailEmployee(e)} title="Ver detalhes"><Eye className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(e)} title="Editar"><Edit className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
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

      <EmployeeDetailSheet employee={detailEmployee} onClose={() => setDetailEmployee(null)} />
    </div>
    </FeatureFlagGate>

  );
}

// ============================================================
// Employee detail sheet with tabs (Dados / Contrato / Docs /
// Ocorrências / Folha / Motorista)
// ============================================================
function EmployeeDetailSheet({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  return (
    <Sheet open={!!employee} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        {employee && <EmployeeDetail employee={employee} />}
      </SheetContent>
    </Sheet>
  );
}

function EmployeeDetail({ employee }: { employee: Employee }) {
  const { data: contracts = [] } = useEmployeeContracts(employee.id);
  const { data: advances = [] } = useEmployeeAdvances({ employeeId: employee.id });
  const { data: incidentActions = [] } = useEmployeeIncidentActions(employee.id);
  const { data: payrollEntries = [] } = useQuery({
    queryKey: ['employee_payroll_entries', employee.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_entries')
        .select('*, payroll_periods(period_name, period_start, period_end, status)')
        .eq('employee_id', employee.id)
        .order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data as any[];
    },
  });
  const { data: driverInfo } = useQuery({
    queryKey: ['employee_driver_info', employee.driver_id],
    queryFn: async () => {
      if (!employee.driver_id) return null;
      const { data, error } = await supabase.from('drivers')
        .select('id, name, cnh_number, phone, active')
        .eq('id', employee.driver_id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!employee.driver_id,
  });
  const { data: driverSettlements = [] } = useQuery({
    queryKey: ['employee_driver_settlements', employee.driver_id],
    queryFn: async () => {
      if (!employee.driver_id) return [];
      const { data, error } = await supabase.from('driver_settlements')
        .select('id, trip_started_at, trip_completed_at, created_at, status, driver_payable_amount, total_paid_amount')
        .eq('driver_id', employee.driver_id)
        .order('trip_completed_at', { ascending: false, nullsFirst: false }).limit(10);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!employee.driver_id,
  });

  const fmtBRL = (n: number) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <>
      <SheetHeader>
        <SheetTitle>{employee.name}</SheetTitle>
        <p className="text-xs text-muted-foreground">{employee.role_title || 'Sem cargo'} · {employee.branch || 'Sem filial'}</p>
      </SheetHeader>
      <Tabs defaultValue="dados" className="mt-4">
        <TabsList className="w-full flex-wrap h-auto">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="contrato">Contrato</TabsTrigger>
          <TabsTrigger value="ocorrencias">Ocorrências</TabsTrigger>
          <TabsTrigger value="folha">Folha</TabsTrigger>
          <TabsTrigger value="motorista">Motorista</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div><p className="text-[10px] uppercase text-muted-foreground">CPF</p><p>{employee.doc_cpf || '—'}</p></div>
            <div><p className="text-[10px] uppercase text-muted-foreground">Telefone</p><p>{employee.phone || '—'}</p></div>
            <div><p className="text-[10px] uppercase text-muted-foreground">Email</p><p>{employee.email || '—'}</p></div>
            <div><p className="text-[10px] uppercase text-muted-foreground">Admissão</p><p>{employee.hire_date ? format(parseISO(employee.hire_date), 'dd/MM/yyyy') : '—'}</p></div>
            <div><p className="text-[10px] uppercase text-muted-foreground">Centro de custo</p><p>{employee.cost_center || '—'}</p></div>
            <div><p className="text-[10px] uppercase text-muted-foreground">Status</p><p>{EMPLOYEE_STATUS_LABELS[employee.status]}</p></div>
          </div>
        </TabsContent>

        <TabsContent value="contrato">
          <ContractTab employeeId={employee.id} contracts={contracts} />
        </TabsContent>

        <TabsContent value="ocorrencias" className="space-y-2">
          {incidentActions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Sem ocorrências registradas.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data</TableHead><TableHead>Ocorrência</TableHead>
                <TableHead>Ação</TableHead><TableHead className="text-right">Desconto</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {incidentActions.map((a: any) => (
                  <TableRow key={a.id} className={Number(a.amount) > 0 ? 'bg-red-500/5' : ''}>
                    <TableCell className="text-xs">{a.created_at ? format(new Date(a.created_at), 'dd/MM/yyyy') : '—'}</TableCell>
                    <TableCell className="text-xs">{a.incidents?.title || '—'}</TableCell>
                    <TableCell className="text-xs">{a.action_type || a.description || '—'}</TableCell>
                    <TableCell className="text-right text-xs">{a.amount ? fmtBRL(Number(a.amount)) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="folha" className="space-y-2">
          {payrollEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Sem entradas de folha.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Bruto</TableHead>
                <TableHead className="text-right">Descontos</TableHead>
                <TableHead className="text-right">Já pago</TableHead>
                <TableHead className="text-right">A pagar</TableHead>
                <TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {payrollEntries.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs">{e.payroll_periods?.period_name || '—'}</TableCell>
                    <TableCell className="text-right text-xs">{fmtBRL(Number(e.gross_amount))}</TableCell>
                    <TableCell className="text-right text-xs text-red-600">{fmtBRL(Number(e.discount_amount))}</TableCell>
                    <TableCell className="text-right text-xs">{fmtBRL(Number(e.already_paid_amount))}</TableCell>
                    <TableCell className="text-right text-xs font-medium">{fmtBRL(Number(e.amount_to_pay))}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{e.payroll_periods?.status || e.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="mt-3">
            <p className="text-xs font-semibold mb-1">Adiantamentos</p>
            {advances.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem adiantamentos.</p>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Motivo</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {advances.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{format(parseISO(a.advance_date), 'dd/MM/yyyy')}</TableCell>
                      <TableCell className="text-right text-xs">{fmtBRL(Number(a.amount))}</TableCell>
                      <TableCell className="text-xs">{a.reason || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{ADVANCE_STATUS_LABELS[a.status] ?? a.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="motorista" className="space-y-2 text-sm">
          {!employee.driver_id ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sem motorista vinculado.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-[10px] uppercase text-muted-foreground">Motorista</p><p>{driverInfo?.name || '—'}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">CNH</p><p>{driverInfo?.cnh_number || '—'}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Telefone</p><p>{driverInfo?.phone || '—'}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Ativo</p><p>{driverInfo?.active ? 'Sim' : 'Não'}</p></div>
              </div>
              <p className="text-xs font-semibold mt-4 mb-1">Acertos recentes</p>
              {driverSettlements.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem acertos.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">A pagar</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {driverSettlements.map((s: any) => {
                      const start = s.trip_started_at || s.created_at;
                      const end = s.trip_completed_at || s.created_at;
                      const fmtDate = (d: string | null | undefined) =>
                        d ? format(new Date(d), 'dd/MM/yyyy') : '—';
                      return (
                      <TableRow key={s.id}>
                        <TableCell className="text-xs">{fmtDate(start)} → {fmtDate(end)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtBRL(Number(s.driver_payable_amount))}</TableCell>
                        <TableCell className="text-right text-xs">{fmtBRL(Number(s.total_paid_amount))}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{s.status}</Badge></TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

function ContractTab({ employeeId, contracts }: { employeeId: string; contracts: any[] }) {
  const create = useCreateEmployeeContract();
  const update = useUpdateEmployeeContract();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    contract_type: 'employee', employment_regime: 'clt', payment_cycle: 'monthly',
    position_title: '', base_salary: '', start_date: format(new Date(), 'yyyy-MM-dd'),
  });
  const handleCreate = async () => {
    if (!form.start_date) { toast.error('Data de início obrigatória'); return; }
    try {
      await create.mutateAsync({
        employee_id: employeeId,
        contract_type: form.contract_type,
        employment_regime: form.employment_regime,
        payment_cycle: form.payment_cycle,
        position_title: form.position_title || null,
        base_salary: Number(form.base_salary) || 0,
        start_date: form.start_date,
        active: true,
      } as any);
      toast.success('Contrato criado (anterior desativado automaticamente)');
      setShowNew(false);
    } catch (e: any) { toast.error(e.message); }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm font-medium">Contratos ({contracts.length})</p>
        <Button size="sm" onClick={() => setShowNew(v => !v)}>{showNew ? 'Cancelar' : 'Novo contrato ativo'}</Button>
      </div>
      {showNew && (
        <Card><CardContent className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Tipo</Label>
              <Select value={form.contract_type} onValueChange={v => setForm(f => ({ ...f, contract_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONTRACT_TYPES.map(t => <SelectItem key={t} value={t}>{CONTRACT_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Regime</Label>
              <Select value={form.employment_regime} onValueChange={v => setForm(f => ({ ...f, employment_regime: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EMPLOYMENT_REGIMES.map(r => <SelectItem key={r} value={r}>{EMPLOYMENT_REGIME_LABELS[r]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Ciclo</Label>
              <Select value={form.payment_cycle} onValueChange={v => setForm(f => ({ ...f, payment_cycle: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_CYCLES.map(c => <SelectItem key={c} value={c}>{PAYMENT_CYCLE_LABELS[c]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Início</Label><Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
            <div><Label className="text-xs">Cargo</Label><Input value={form.position_title} onChange={e => setForm(f => ({ ...f, position_title: e.target.value }))} /></div>
            <div><Label className="text-xs">Salário base</Label><Input type="number" step="0.01" value={form.base_salary} onChange={e => setForm(f => ({ ...f, base_salary: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end"><Button size="sm" onClick={handleCreate} disabled={create.isPending}>Salvar</Button></div>
        </CardContent></Card>
      )}
      {contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Sem contratos cadastrados.</p>
      ) : (
        <Table>
          <TableHeader><TableRow>
            <TableHead>Ativo</TableHead><TableHead>Tipo</TableHead><TableHead>Cargo</TableHead>
            <TableHead>Início</TableHead><TableHead>Fim</TableHead>
            <TableHead className="text-right">Salário</TableHead>
            <TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {contracts.map((c: any) => (
              <TableRow key={c.id}>
                <TableCell>{c.active ? <Badge className="text-[10px]">Ativo</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs">{CONTRACT_TYPE_LABELS[c.contract_type] || c.contract_type}</TableCell>
                <TableCell className="text-xs">{c.position_title || '—'}</TableCell>
                <TableCell className="text-xs">{c.start_date}</TableCell>
                <TableCell className="text-xs">{c.end_date || '—'}</TableCell>
                <TableCell className="text-right text-xs">{Number(c.base_salary || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</TableCell>
                <TableCell>
                  {c.active && (
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: c.id, active: false, end_date: format(new Date(), 'yyyy-MM-dd') })}>
                      Desativar
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
