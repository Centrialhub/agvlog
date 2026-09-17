import {parseFinanceAmount,formatFinanceCents} from '@/lib/financial/ledgerContract';
import {EmployeeAdvanceActionDialog} from '../EmployeeAdvanceActionDialog';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {EmployeeAdvancePaymentDialog} from '../EmployeeAdvancePaymentDialog';
import { useState } from 'react';
import { format } from 'date-fns';
import { useEmployees } from '@/hooks/useEmployees';
import {
  ADVANCE_STATUS_LABELS,
  useEmployeeAdvances,
  useRegisterEmployeeAdvance,
} from '@/hooks/usePayroll';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtDateSafe } from '@/lib/utils/formatDate';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { getErrorMessage } from '@/lib/errors';
import { formatPayrollCurrency } from './formatPayrollCurrency';

export function AdvancesTable() {
  const {currentTenant}=useTenant();const {user}=useAuth();const [payment,setPayment]=useState<{tenant:string;actor:string;id:string}|null>(null);
  const query = useEmployeeAdvances();
  const advances = query.isFetching || query.isError ? [] : query.data ?? [];
  const [statusAction,setStatusAction]=useState<{tenant:string;actor:string;id:string;action:'approve'|'cancel'}|null>(null);
  const changeStatus=(id:string,action:'approve'|'cancel')=>{if(currentTenant&&user)setStatusAction({tenant:currentTenant.id,actor:user.id,id,action});};
  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow><TableHead>Funcionário</TableHead><TableHead>Data</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Motivo</TableHead><TableHead>Status</TableHead><TableHead className="w-40"></TableHead></TableRow></TableHeader>
        <TableBody>
          {query.isFetching ? <TableRow><TableCell colSpan={6}><p role="status">Consultando adiantamentos…</p></TableCell></TableRow>
            : query.isError ? <TableRow><TableCell colSpan={6}><p role="alert">Não foi possível consultar os adiantamentos.</p><Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></TableCell></TableRow>
            : advances.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Nenhum adiantamento</TableCell></TableRow>
            : advances.map(advance => (
              <TableRow key={advance.id}>
                <TableCell className="text-sm font-medium">{advance.employees?.name ?? advance.employee_id.slice(0, 8)}</TableCell>
                <TableCell className="text-sm">{fmtDateSafe(advance.advance_date)}</TableCell>
                <TableCell className="text-right text-sm">{formatPayrollCurrency(Number(advance.amount))}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{advance.reason ?? '—'}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{ADVANCE_STATUS_LABELS[advance.status] ?? advance.status}</Badge></TableCell>
                <TableCell><div className="flex gap-1">
                  {advance.status === 'pending' && <Button size="sm" variant="outline" disabled={!currentTenant||!user} onClick={() => changeStatus(advance.id, 'approve')}>Aprovar</Button>}
                  {(advance.status === 'approved' || advance.status === 'pending') && <Button size="sm" disabled={!currentTenant||!user} onClick={() => {if(currentTenant&&user)setPayment({tenant:currentTenant.id,actor:user.id,id:advance.id});}}>Conferir pagamento</Button>}
                  {advance.status !== 'cancelled' && advance.status !== 'paid' && <Button size="sm" variant="ghost" disabled={!currentTenant||!user} onClick={() => changeStatus(advance.id, 'cancel')}>Cancelar</Button>}
                </div></TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    {statusAction&&currentTenant?.id===statusAction.tenant&&user?.id===statusAction.actor&&<EmployeeAdvanceActionDialog tenant={statusAction.tenant} actor={statusAction.actor} advance={statusAction.id} action={statusAction.action} open onOpenChange={open=>{if(!open)setStatusAction(null);}}/>}
    {payment&&currentTenant?.id===payment.tenant&&user?.id===payment.actor&&<EmployeeAdvancePaymentDialog tenant={payment.tenant} actor={payment.actor} advance={payment.id} open onOpenChange={open=>{if(!open)setPayment(null);}}/>}</CardContent></Card>
  );
}

export function RegisterAdvanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useSonnerToast();
  const { data: employees = [] } = useEmployees();
  const register = useRegisterEmployeeAdvance();
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [advanceDate, setAdvanceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'pix'|'bank_transfer'|'cash'|'check'|'other'>('pix');
  const [ref, setRef] = useState('');
  const [createPayable, setCreatePayable] = useState(false);

  const handle = async () => {
    const parsedAmount = parseFinanceAmount(amount.replace('.',','));
    if (!employeeId || parsedAmount === null) { toast.error('Funcionário e valor obrigatórios'); return; }
    try {
      await register.mutateAsync({
        employee_id: employeeId,
        amount_cents: String(parsedAmount),
        advance_date: advanceDate,
        reason,
        payment_method: method,
        payment_reference: ref,
        create_payable: createPayable,
      });
      toast.success('Adiantamento registrado');
      onOpenChange(false);
      setEmployeeId(''); setAmount(''); setReason(''); setRef(''); setCreatePayable(false);
    } catch (mutationError) {
      toast.error(getErrorMessage(mutationError, 'Não foi possível registrar o adiantamento.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrar adiantamento</DialogTitle></DialogHeader>
        <fieldset disabled={register.isPending||!!register.pending||!!register.storageError} className="space-y-3">
          <div>
            <Label className="text-xs">Funcionário *</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>{employees.map(employee => <SelectItem key={employee.id} value={employee.id}>{employee.name}{employee.driver_id ? ' — motorista' : ''}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Valor *</Label><Input type="number" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></div>
            <div><Label className="text-xs">Data</Label><Input type="date" value={advanceDate} onChange={event => setAdvanceDate(event.target.value)} /></div>
            <div><Label className="text-xs">Método</Label>
              <Select value={method} onValueChange={value=>setMethod(value as typeof method)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="pix">Pix</SelectItem><SelectItem value="bank_transfer">Transferência</SelectItem><SelectItem value="cash">Dinheiro</SelectItem><SelectItem value="check">Cheque</SelectItem><SelectItem value="other">Outro</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Referência</Label><Input value={ref} onChange={event => setRef(event.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Motivo</Label><Textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={createPayable} onChange={event => setCreatePayable(event.target.checked)} /> Gerar conta a pagar</label>
<p className="text-sm">Depois de registrar, use Conferir pagamento para vincular uma saída existente. O cadastro não comprova pagamento.</p>
        </fieldset>
        {register.storageError&&<p role="alert">{register.storageError}</p>}
        {register.pending&&<section aria-label="Cadastro preservado"><p>Pedido {register.pending.payload.request_id} · funcionário {register.pending.payload.employee_id} · valor {formatFinanceCents(register.pending.payload.amount_cents)}</p><p>Motivo: {register.pending.payload.reason}</p><Button disabled={register.isPending} onClick={async()=>{try{await register.mutateAsync(null);toast.success('Cadastro confirmado; nenhum pagamento foi criado.');onOpenChange(false);}catch(error){toast.error(getErrorMessage(error,'O cadastro ainda não foi confirmado. Preserve o pedido original.'));}}}>Recuperar cadastro preservado</Button></section>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handle} disabled={register.isPending||!!register.pending||!!register.storageError||reason.trim().length<10}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
