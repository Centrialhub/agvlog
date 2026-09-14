import { useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useScopedAlerts } from '@/hooks/useAlertStore';
import {
  PAYROLL_ITEM_TYPE_LABELS,
  type PayrollEntry,
  type PayrollEntryItem,
  type PayrollPeriod,
  useAddPayrollManualItem,
  useDeletePayrollItem,
  usePayrollEntries,
  usePayrollEntryItems,
  useRecalculatePayrollEntry,
} from '@/hooks/usePayroll';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { getErrorMessage } from '@/lib/errors';
import { payrollPaymentIssues, payrollPaymentLabels } from '@/lib/financial/payrollPaymentContract';
import { formatPayrollCurrency } from './formatPayrollCurrency';

export function EntryDrawer({ entry: selectedEntry, period, onClose }: { entry: PayrollEntry | null; period: PayrollPeriod | null; onClose: () => void }) {
  const paymentQuery=usePayrollEntries(selectedEntry?.payroll_period_id);
  const paymentBusy=paymentQuery.isPending||paymentQuery.isFetching;
  const paymentError=paymentQuery.error;
  const entry=!paymentBusy&&!paymentError?paymentQuery.data?.find(row=>row.id===selectedEntry?.id)??null:null;
  const { promptAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const itemQuery=usePayrollEntryItems(selectedEntry?.id);
  const itemsBusy=itemQuery.isPending||itemQuery.isFetching;
  const items=itemsBusy||itemQuery.isError?[]:itemQuery.data??[];
  const recalc = useRecalculatePayrollEntry();
  const addItem = useAddPayrollManualItem();
  const delItem = useDeletePayrollItem();
  const [manualDesc, setManualDesc] = useState('');
  const [manualAmt, setManualAmt] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualNature, setManualNature] = useState<'credit' | 'debit'>('debit');

  const locked = paymentBusy||!!paymentError||itemsBusy||itemQuery.isError||!entry||!period || period.status === 'approved' || period.status === 'closed' || period.status === 'cancelled';

  const handleAdd = async () => {
    if (!entry||locked) return;
    const amount = Number(manualAmt);
    if (!manualDesc.trim() || !amount || amount <= 0) { toast.error('Descrição e valor obrigatórios'); return; }
    if (!manualReason.trim()) { toast.error('Motivo do ajuste obrigatório'); return; }
    try {
      await addItem.mutateAsync({ entry, nature: manualNature, description: manualDesc, amount, reason: manualReason });
      setManualDesc(''); setManualAmt(''); setManualReason('');
      toast.success('Ajuste adicionado');
    } catch (mutationError) {
      toast.error(getErrorMessage(mutationError, 'Não foi possível adicionar o ajuste.'));
    }
  };

  const handleDelete = async (item: PayrollEntryItem) => {
    if(locked)return;
    const reason = await promptAction('Informe por que este item deve ser removido.', {
      title: 'Excluir item da folha',
      label: 'Motivo da exclusão',
    });
    if (!reason) return;
    try { await delItem.mutateAsync({ item, reason }); toast.success('Item removido'); }
    catch (mutationError) { toast.error(getErrorMessage(mutationError, 'Não foi possível remover o item.')); }
  };

  return (
    <Sheet open={!!selectedEntry} onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader><SheetTitle>Detalhe da folha</SheetTitle></SheetHeader>
        {selectedEntry&&paymentBusy&&<p role="status">Conferindo valores da folha…</p>}
        {selectedEntry&&paymentError&&<><p role="alert">Não foi possível consultar os valores da folha.</p><Button onClick={()=>void paymentQuery.refetch()}>Tentar consultar folha novamente</Button></>}
        {selectedEntry&&!paymentBusy&&!paymentError&&!entry&&<p role="status">Entrada não encontrada na consulta atual.</p>}
        {entry && (
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-4 gap-2 text-sm">
              <div><p className="text-[10px] uppercase text-muted-foreground">Bruto</p><p className="font-bold">{formatPayrollCurrency(Number(entry.gross_amount))}</p></div>
              <div><p className="text-[10px] uppercase text-muted-foreground">Desc.</p><p className="font-bold text-red-600">{formatPayrollCurrency(Number(entry.discount_amount))}</p></div>
              <div><p className="text-[10px] uppercase text-muted-foreground">Pago antes da folha</p><p className="font-bold">{formatPayrollCurrency(Number(entry.already_paid_amount))}</p></div>
              <div><p className="text-[10px] uppercase text-muted-foreground">Saldo original</p><p className="font-bold">{formatPayrollCurrency(Number(entry.amount_to_pay))}</p></div>
            </div>
            {paymentError ? <p role="alert" className="text-destructive">Não foi possível atualizar os pagamentos.</p> : entry.payment_summary && <div className="text-sm space-y-1">
              <p>Pago pelos títulos: {formatPayrollCurrency(Number(entry.payment_summary.paid_via_titles))}</p>
              <p className="font-bold">Saldo restante: {formatPayrollCurrency(Number(entry.payment_summary.remaining_amount))}</p>
              <p>Pagamento: {payrollPaymentLabels[entry.payment_summary.status]}</p>
              {entry.payment_summary.issues.map(issue => <p key={issue} className="text-destructive">{payrollPaymentIssues[issue] ?? issue}</p>)}
              <p className="text-muted-foreground">Confirmação bancária não avaliada nesta consulta.</p>
            </div>}

            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Descrição</TableHead><TableHead>Nat.</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {itemsBusy?<TableRow><TableCell colSpan={5}><p role="status">Consultando itens da folha…</p></TableCell></TableRow>:itemQuery.isError?<TableRow><TableCell colSpan={5}><p role="alert">Não foi possível consultar os itens da folha.</p><Button onClick={()=>void itemQuery.refetch()}>Tentar consultar itens novamente</Button></TableCell></TableRow>:items.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">Sem itens</TableCell></TableRow>
                    : items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="text-xs">{PAYROLL_ITEM_TYPE_LABELS[item.item_type] ?? item.item_type}</TableCell>
                        <TableCell className="text-xs">{item.description}</TableCell>
                        <TableCell><Badge variant="outline" className={`text-[10px] ${item.nature === 'credit' ? 'text-green-600' : item.nature === 'debit' ? 'text-red-600' : item.nature === 'already_paid' ? 'text-blue-600' : ''}`}>{item.nature}</Badge></TableCell>
                        <TableCell className="text-right text-xs">{formatPayrollCurrency(Number(item.amount))}</TableCell>
                        <TableCell>{!locked && !item.locked && <Button variant="ghost" size="icon" onClick={() => handleDelete(item)}><Trash2 className="h-3 w-3" /></Button>}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent></Card>

            {!locked && <Card><CardContent className="py-3 space-y-2">
              <p className="text-sm font-medium">Adicionar ajuste manual</p>
              <div className="grid grid-cols-4 gap-2">
                <Select value={manualNature} onValueChange={value => setManualNature(value as 'credit' | 'debit')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="credit">Crédito</SelectItem><SelectItem value="debit">Débito</SelectItem></SelectContent>
                </Select>
                <Input className="col-span-2" placeholder="Descrição *" value={manualDesc} onChange={event => setManualDesc(event.target.value)} />
                <Input type="number" step="0.01" placeholder="Valor" value={manualAmt} onChange={event => setManualAmt(event.target.value)} />
              </div>
              <Textarea rows={2} placeholder="Motivo (obrigatório, será registrado em auditoria) *" value={manualReason} onChange={event => setManualReason(event.target.value)} />
              <div className="flex justify-between">
                <Button size="sm" variant="outline" onClick={() => recalc.mutate(entry.id)} disabled={recalc.isPending}><RefreshCw className="h-4 w-4 mr-1" /> Recalcular</Button>
                <Button size="sm" onClick={handleAdd} disabled={addItem.isPending}>Adicionar</Button>
              </div>
            </CardContent></Card>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
