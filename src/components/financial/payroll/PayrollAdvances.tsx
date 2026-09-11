import { useState } from 'react';
import { format } from 'date-fns';
import { useEmployees } from '@/hooks/useEmployees';
import {
  ADVANCE_STATUS_LABELS,
  useEmployeeAdvances,
  useRegisterEmployeeAdvance,
  useUpdateAdvanceStatus,
} from '@/hooks/usePayroll';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { getErrorMessage } from '@/lib/errors';
import { formatPayrollCurrency } from './formatPayrollCurrency';

export function AdvancesTable() {
  const { data: advances = [] } = useEmployeeAdvances();
  const upd = useUpdateAdvanceStatus();
  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow><TableHead>Funcionário</TableHead><TableHead>Data</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Motivo</TableHead><TableHead>Status</TableHead><TableHead className="w-40"></TableHead></TableRow></TableHeader>
        <TableBody>
          {advances.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Nenhum adiantamento</TableCell></TableRow>
            : advances.map(advance => (
              <TableRow key={advance.id}>
                <TableCell className="text-sm font-medium">{advance.employees?.name ?? advance.employee_id.slice(0, 8)}</TableCell>
                <TableCell className="text-sm">{format(new Date(advance.advance_date), 'dd/MM/yyyy')}</TableCell>
                <TableCell className="text-right text-sm">{formatPayrollCurrency(Number(advance.amount))}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{advance.reason ?? '—'}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{ADVANCE_STATUS_LABELS[advance.status] ?? advance.status}</Badge></TableCell>
                <TableCell><div className="flex gap-1">
                  {advance.status === 'pending' && <Button size="sm" variant="outline" onClick={() => upd.mutate({ id: advance.id, status: 'approved' })}>Aprovar</Button>}
                  {(advance.status === 'approved' || advance.status === 'pending') && <Button size="sm" onClick={() => upd.mutate({ id: advance.id, status: 'paid' })}>Pagar</Button>}
                  {advance.status !== 'cancelled' && advance.status !== 'paid' && <Button size="sm" variant="ghost" onClick={() => upd.mutate({ id: advance.id, status: 'cancelled' })}>Cancelar</Button>}
                </div></TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </CardContent></Card>
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
  const [method, setMethod] = useState('pix');
  const [ref, setRef] = useState('');
  const [createPayable, setCreatePayable] = useState(false);
  const [markPaid, setMarkPaid] = useState(false);

  const handle = async () => {
    const parsedAmount = Number(amount);
    if (!employeeId || !parsedAmount || parsedAmount <= 0) { toast.error('Funcionário e valor obrigatórios'); return; }
    try {
      await register.mutateAsync({
        employee_id: employeeId,
        amount: parsedAmount,
        advance_date: advanceDate,
        reason,
        payment_method: method,
        payment_reference: ref,
        create_payable: createPayable,
        mark_paid: markPaid,
      });
      toast.success('Adiantamento registrado');
      onOpenChange(false);
      setEmployeeId(''); setAmount(''); setReason(''); setRef(''); setCreatePayable(false); setMarkPaid(false);
    } catch (mutationError) {
      toast.error(getErrorMessage(mutationError, 'Não foi possível registrar o adiantamento.'));
    }
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
              <SelectContent>{employees.map(employee => <SelectItem key={employee.id} value={employee.id}>{employee.name}{employee.driver_id ? ' — motorista' : ''}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Valor *</Label><Input type="number" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></div>
            <div><Label className="text-xs">Data</Label><Input type="date" value={advanceDate} onChange={event => setAdvanceDate(event.target.value)} /></div>
            <div><Label className="text-xs">Método</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="pix">Pix</SelectItem><SelectItem value="bank_transfer">Transferência</SelectItem><SelectItem value="cash">Dinheiro</SelectItem><SelectItem value="check">Cheque</SelectItem><SelectItem value="other">Outro</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Referência</Label><Input value={ref} onChange={event => setRef(event.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Motivo</Label><Textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={createPayable} onChange={event => setCreatePayable(event.target.checked)} /> Gerar conta a pagar</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={markPaid} onChange={event => setMarkPaid(event.target.checked)} /> Já foi pago</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handle} disabled={register.isPending}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
