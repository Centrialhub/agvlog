import { useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import {
  usePayrollPeriods, usePayrollEntries, usePayrollEntryItems,
  useGeneratePayrollPeriod, useApprovePayrollPeriod, useClosePayrollPeriod,
  useRecalculatePayrollEntry, useAddPayrollManualItem, useDeletePayrollItem,
  PayrollPeriod, PayrollEntry, PayrollEntryItem,
  PAYROLL_PERIOD_STATUS_LABELS, PAYROLL_PAYMENT_STATUS_LABELS, PAYROLL_ITEM_TYPE_LABELS,
  useEmployeeAdvances, useRegisterEmployeeAdvance, useUpdateAdvanceStatus, ADVANCE_STATUS_LABELS,
} from '@/hooks/usePayroll';
import { useEmployees } from '@/hooks/useEmployees';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wallet, Plus, RefreshCw, CheckCircle2, Lock, Trash2, HandCoins } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

const fmtBRL = (n: number) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function statusBadge(s: string) {
  const map: Record<string,string> = {
    draft: 'bg-muted text-muted-foreground',
    calculated: 'bg-blue-500/10 text-blue-600',
    under_review: 'bg-amber-500/10 text-amber-600',
    approved: 'bg-green-500/10 text-green-600',
    closed: 'bg-slate-500/10 text-slate-600',
    cancelled: 'bg-red-500/10 text-red-600',
  };
  return <Badge variant="outline" className={`text-[10px] ${map[s] ?? ''}`}>{PAYROLL_PERIOD_STATUS_LABELS[s as keyof typeof PAYROLL_PERIOD_STATUS_LABELS] ?? s}</Badge>;
}

export default function Payroll() {
  const { data: periods = [], isLoading } = usePayrollPeriods();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [entryDrawer, setEntryDrawer] = useState<PayrollEntry | null>(null);

  const activePeriod = periods.find(p => p.id === selectedPeriodId) ?? periods[0] ?? null;
  const currentPeriodId = activePeriod?.id;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Wallet className="h-5 w-5" /> Folha de Pagamento</h1>
          <p className="text-sm text-muted-foreground">Pré-folha integrada com acertos, despesas, adiantamentos e ocorrências</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdvanceOpen(true)}>
            <HandCoins className="h-4 w-4 mr-1" /> Adiantamento
          </Button>
          <Button size="sm" onClick={() => setGenOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Gerar Folha
          </Button>
        </div>
      </div>

      <Tabs defaultValue="periods">
        <TabsList>
          <TabsTrigger value="periods">Períodos</TabsTrigger>
          <TabsTrigger value="entries" disabled={!currentPeriodId}>Entradas</TabsTrigger>
          <TabsTrigger value="advances">Adiantamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="periods" className="space-y-3">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Período</TableHead><TableHead>Início</TableHead><TableHead>Fim</TableHead>
                <TableHead>Status</TableHead><TableHead>Pagamento</TableHead><TableHead className="w-10"></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Carregando...</TableCell></TableRow>
                : periods.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Nenhum período. Clique em "Gerar Folha".</TableCell></TableRow>
                : periods.map(p => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedPeriodId(p.id)}>
                    <TableCell className="font-medium text-sm">{p.period_name}</TableCell>
                    <TableCell className="text-sm">{format(new Date(p.period_start), 'dd/MM/yyyy')}</TableCell>
                    <TableCell className="text-sm">{format(new Date(p.period_end), 'dd/MM/yyyy')}</TableCell>
                    <TableCell>{statusBadge(p.status)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{PAYROLL_PAYMENT_STATUS_LABELS[p.payment_status] ?? p.payment_status}</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedPeriodId(p.id); }}>Abrir</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="entries">
          {activePeriod && <PeriodEntries period={activePeriod} onOpenEntry={setEntryDrawer} />}
        </TabsContent>

        <TabsContent value="advances">
          <AdvancesTable />
        </TabsContent>
      </Tabs>

      <GeneratePeriodDialog open={genOpen} onOpenChange={setGenOpen} onGenerated={setSelectedPeriodId} />
      <RegisterAdvanceDialog open={advanceOpen} onOpenChange={setAdvanceOpen} />
      <EntryDrawer entry={entryDrawer} period={activePeriod} onClose={() => setEntryDrawer(null)} />
    </div>
  );
}

// -------------------- Period entries --------------------
function PeriodEntries({ period, onOpenEntry }: { period: PayrollPeriod; onOpenEntry: (e: PayrollEntry) => void }) {
  const { data: entries = [], isLoading } = usePayrollEntries(period.id);
  const approve = useApprovePayrollPeriod();
  const close = useClosePayrollPeriod();
  const gen = useGeneratePayrollPeriod();

  const totals = useMemo(() => entries.reduce((acc, e) => ({
    gross: acc.gross + Number(e.gross_amount || 0),
    disc: acc.disc + Number(e.discount_amount || 0),
    paid: acc.paid + Number(e.already_paid_amount || 0),
    toPay: acc.toPay + Number(e.amount_to_pay || 0),
  }), { gross: 0, disc: 0, paid: 0, toPay: 0 }), [entries]);

  const locked = period.status === 'approved' || period.status === 'closed' || period.status === 'cancelled';

  const handleApprove = async () => {
    if (!confirm('Aprovar folha? Itens serão travados e contas a pagar serão geradas para os saldos.')) return;
    try { await approve.mutateAsync(period.id); toast.success('Folha aprovada'); }
    catch (e: any) { toast.error(e.message); }
  };
  const handleClose = async () => {
    const reason = prompt('Motivo do fechamento (obrigatório se houver saldo em aberto):') ?? undefined;
    try { await close.mutateAsync({ period_id: period.id, reason }); toast.success('Folha fechada'); }
    catch (e: any) { toast.error(e.message); }
  };
  const handleRegen = async () => {
    try {
      await gen.mutateAsync({
        period_start: period.period_start, period_end: period.period_end,
        period_name: period.period_name,
        include_drivers: period.include_drivers, include_non_drivers: period.include_non_drivers,
      });
      toast.success('Folha recalculada');
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] text-muted-foreground uppercase">Funcionários</p>
          <p className="text-lg font-bold">{entries.length}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] text-muted-foreground uppercase">Bruto</p>
          <p className="text-lg font-bold">{fmtBRL(totals.gross)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] text-muted-foreground uppercase">Descontos</p>
          <p className="text-lg font-bold text-red-600">{fmtBRL(totals.disc)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] text-muted-foreground uppercase">Já pago</p>
          <p className="text-lg font-bold">{fmtBRL(totals.paid)}</p>
        </CardContent></Card>
        <Card className="border-primary/50"><CardContent className="py-3 px-4">
          <p className="text-[10px] text-muted-foreground uppercase">Saldo a pagar</p>
          <p className="text-lg font-bold text-primary">{fmtBRL(totals.toPay)}</p>
        </CardContent></Card>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{period.period_name}</span>
          {statusBadge(period.status)}
        </div>
        <div className="flex gap-2">
          {!locked && <Button size="sm" variant="outline" onClick={handleRegen} disabled={gen.isPending}>
            <RefreshCw className="h-4 w-4 mr-1" /> Recalcular
          </Button>}
          {!locked && <Button size="sm" onClick={handleApprove} disabled={approve.isPending || entries.length === 0}>
            <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
          </Button>}
          {period.status === 'approved' && <Button size="sm" variant="secondary" onClick={handleClose} disabled={close.isPending}>
            <Lock className="h-4 w-4 mr-1" /> Fechar
          </Button>}
        </div>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Funcionário</TableHead><TableHead>Tipo</TableHead>
            <TableHead className="text-right">Bruto</TableHead>
            <TableHead className="text-right">Descontos</TableHead>
            <TableHead className="text-right">Já pago</TableHead>
            <TableHead className="text-right">A pagar</TableHead>
            <TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">Carregando...</TableCell></TableRow>
            : entries.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">Sem entradas</TableCell></TableRow>
            : entries.map(e => (
              <TableRow key={e.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onOpenEntry(e as any)}>
                <TableCell className="text-sm font-medium">{(e as any).employees?.name ?? e.employee_id.slice(0,8)}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{e.entry_type === 'driver' ? 'Motorista' : 'Funcionário'}</Badge></TableCell>
                <TableCell className="text-right text-sm">{fmtBRL(Number(e.gross_amount))}</TableCell>
                <TableCell className="text-right text-sm text-red-600">{fmtBRL(Number(e.discount_amount))}</TableCell>
                <TableCell className="text-right text-sm">{fmtBRL(Number(e.already_paid_amount))}</TableCell>
                <TableCell className="text-right text-sm font-bold">{fmtBRL(Number(e.amount_to_pay))}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{PAYROLL_PERIOD_STATUS_LABELS[e.status as any] ?? e.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// -------------------- Entry drawer --------------------
function EntryDrawer({ entry, period, onClose }: { entry: PayrollEntry | null; period: PayrollPeriod | null; onClose: () => void }) {
  const { data: items = [] } = usePayrollEntryItems(entry?.id);
  const recalc = useRecalculatePayrollEntry();
  const addItem = useAddPayrollManualItem();
  const delItem = useDeletePayrollItem();
  const [manualDesc, setManualDesc] = useState('');
  const [manualAmt, setManualAmt] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualNature, setManualNature] = useState<'credit'|'debit'>('debit');

  const locked = !period || period.status === 'approved' || period.status === 'closed' || period.status === 'cancelled';

  const handleAdd = async () => {
    if (!entry) return;
    const amt = Number(manualAmt);
    if (!manualDesc.trim() || !amt || amt <= 0) { toast.error('Descrição e valor obrigatórios'); return; }
    if (!manualReason.trim()) { toast.error('Motivo do ajuste obrigatório'); return; }
    try {
      await addItem.mutateAsync({ entry, nature: manualNature, description: manualDesc, amount: amt, reason: manualReason });
      setManualDesc(''); setManualAmt(''); setManualReason('');
      toast.success('Ajuste adicionado');
    } catch (e: any) { toast.error(e.message); }
  };

  const handleDelete = async (item: PayrollEntryItem) => {
    const reason = prompt('Motivo da exclusão (obrigatório):');
    if (!reason || !reason.trim()) { toast.error('Motivo obrigatório'); return; }
    try {
      await delItem.mutateAsync({ item, reason });
      toast.success('Item removido');
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Sheet open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader><SheetTitle>Detalhe da folha</SheetTitle></SheetHeader>
        {entry && (
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-4 gap-2 text-sm">
              <div><p className="text-[10px] uppercase text-muted-foreground">Bruto</p><p className="font-bold">{fmtBRL(Number(entry.gross_amount))}</p></div>
              <div><p className="text-[10px] uppercase text-muted-foreground">Desc.</p><p className="font-bold text-red-600">{fmtBRL(Number(entry.discount_amount))}</p></div>
              <div><p className="text-[10px] uppercase text-muted-foreground">Já pago</p><p className="font-bold">{fmtBRL(Number(entry.already_paid_amount))}</p></div>
              <div><p className="text-[10px] uppercase text-muted-foreground">A pagar</p><p className="font-bold text-primary">{fmtBRL(Number(entry.amount_to_pay))}</p></div>
            </div>

            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Tipo</TableHead><TableHead>Descrição</TableHead>
                  <TableHead>Nat.</TableHead><TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {items.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">Sem itens</TableCell></TableRow>
                  : items.map(i => (
                    <TableRow key={i.id}>
                      <TableCell className="text-xs">{PAYROLL_ITEM_TYPE_LABELS[i.item_type] ?? i.item_type}</TableCell>
                      <TableCell className="text-xs">{i.description}</TableCell>
                      <TableCell><Badge variant="outline" className={`text-[10px] ${i.nature === 'credit' ? 'text-green-600' : i.nature === 'debit' ? 'text-red-600' : i.nature === 'already_paid' ? 'text-blue-600' : ''}`}>{i.nature}</Badge></TableCell>
                      <TableCell className="text-right text-xs">{fmtBRL(Number(i.amount))}</TableCell>
                      <TableCell>
                        {!locked && !i.locked && (
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(i)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>

            {!locked && (
              <Card><CardContent className="py-3 space-y-2">
                <p className="text-sm font-medium">Adicionar ajuste manual</p>
                <div className="grid grid-cols-4 gap-2">
                  <Select value={manualNature} onValueChange={(v: any) => setManualNature(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit">Crédito</SelectItem>
                      <SelectItem value="debit">Débito</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="col-span-2" placeholder="Descrição *" value={manualDesc} onChange={e => setManualDesc(e.target.value)} />
                  <Input type="number" step="0.01" placeholder="Valor" value={manualAmt} onChange={e => setManualAmt(e.target.value)} />
                </div>
                <Textarea rows={2} placeholder="Motivo (obrigatório, será registrado em auditoria) *" value={manualReason} onChange={e => setManualReason(e.target.value)} />
                <div className="flex justify-between">
                  <Button size="sm" variant="outline" onClick={() => recalc.mutate(entry.id)} disabled={recalc.isPending}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Recalcular
                  </Button>
                  <Button size="sm" onClick={handleAdd} disabled={addItem.isPending}>Adicionar</Button>
                </div>
              </CardContent></Card>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// -------------------- Generate dialog --------------------
function GeneratePeriodDialog({ open, onOpenChange, onGenerated }: { open: boolean; onOpenChange: (o: boolean) => void; onGenerated: (id: string) => void }) {
  const gen = useGeneratePayrollPeriod();
  const today = new Date();
  const [start, setStart] = useState(format(startOfMonth(today), 'yyyy-MM-dd'));
  const [end, setEnd] = useState(format(endOfMonth(today), 'yyyy-MM-dd'));
  const [name, setName] = useState('');
  const [incDrivers, setIncDrivers] = useState(true);
  const [incNonDrivers, setIncNonDrivers] = useState(true);

  const handle = async () => {
    if (new Date(end) < new Date(start)) { toast.error('Fim menor que início'); return; }
    if (!incDrivers && !incNonDrivers) { toast.error('Selecione ao menos um grupo'); return; }
    try {
      const id = await gen.mutateAsync({ period_start: start, period_end: end, period_name: name || undefined, include_drivers: incDrivers, include_non_drivers: incNonDrivers });
      toast.success('Folha gerada');
      onGenerated(id);
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Gerar folha de pagamento</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Início *</Label><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
          <div><Label className="text-xs">Fim *</Label><Input type="date" value={end} onChange={e => setEnd(e.target.value)} /></div>
          <div className="col-span-2"><Label className="text-xs">Nome (opcional)</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Folha novembro/2026" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={incDrivers} onChange={e => setIncDrivers(e.target.checked)} /> Incluir motoristas</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={incNonDrivers} onChange={e => setIncNonDrivers(e.target.checked)} /> Incluir demais</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handle} disabled={gen.isPending}>Gerar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Advances --------------------
function AdvancesTable() {
  const { data: advances = [] } = useEmployeeAdvances();
  const upd = useUpdateAdvanceStatus();
  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Funcionário</TableHead><TableHead>Data</TableHead>
          <TableHead className="text-right">Valor</TableHead>
          <TableHead>Motivo</TableHead><TableHead>Status</TableHead>
          <TableHead className="w-40"></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {advances.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Nenhum adiantamento</TableCell></TableRow>
          : advances.map(a => (
            <TableRow key={a.id}>
              <TableCell className="text-sm font-medium">{(a as any).employees?.name ?? a.employee_id.slice(0,8)}</TableCell>
              <TableCell className="text-sm">{format(new Date(a.advance_date), 'dd/MM/yyyy')}</TableCell>
              <TableCell className="text-right text-sm">{fmtBRL(Number(a.amount))}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{a.reason ?? '—'}</TableCell>
              <TableCell><Badge variant="outline" className="text-[10px]">{ADVANCE_STATUS_LABELS[a.status] ?? a.status}</Badge></TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {a.status === 'pending' && <Button size="sm" variant="outline" onClick={() => upd.mutate({ id: a.id, status: 'approved' })}>Aprovar</Button>}
                  {(a.status === 'approved' || a.status === 'pending') && <Button size="sm" onClick={() => upd.mutate({ id: a.id, status: 'paid' })}>Pagar</Button>}
                  {a.status !== 'cancelled' && a.status !== 'paid' && <Button size="sm" variant="ghost" onClick={() => upd.mutate({ id: a.id, status: 'cancelled' })}>Cancelar</Button>}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function RegisterAdvanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: employees = [] } = useEmployees();
  const register = useRegisterEmployeeAdvance();
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [advanceDate, setAdvanceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('pix');
  const [ref, setRef] = useState('');
  const [createPayable, setCreatePayable] = useState(false);
  const [markPaid, setMarkPaid] = useState(false);

  const handle = async () => {
    const amt = Number(amount);
    if (!employeeId || !amt || amt <= 0) { toast.error('Funcionário e valor obrigatórios'); return; }
    try {
      await register.mutateAsync({
        employee_id: employeeId, amount: amt, advance_date: advanceDate, reason, payment_method: method, payment_reference: ref,
        create_payable: createPayable, mark_paid: markPaid,
      });
      toast.success('Adiantamento registrado');
      onOpenChange(false);
      setEmployeeId(''); setAmount(''); setReason(''); setRef(''); setCreatePayable(false); setMarkPaid(false);
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrar adiantamento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Funcionário *</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}{e.driver_id ? ' — motorista' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Valor *</Label><Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div><Label className="text-xs">Data</Label><Input type="date" value={advanceDate} onChange={e => setAdvanceDate(e.target.value)} /></div>
            <div><Label className="text-xs">Método</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="bank_transfer">Transferência</SelectItem>
                  <SelectItem value="cash">Dinheiro</SelectItem>
                  <SelectItem value="check">Cheque</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Referência</Label><Input value={ref} onChange={e => setRef(e.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Motivo</Label><Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={createPayable} onChange={e => setCreatePayable(e.target.checked)} /> Gerar conta a pagar</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={markPaid} onChange={e => setMarkPaid(e.target.checked)} /> Já foi pago</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handle} disabled={register.isPending}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}