import { confirmAction } from '@/hooks/useAlertStore';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';
import {
  useBankAccounts, useRegisterReceivablePayment,
  useReceivablePayments, useReverseReceivablePayment,
  uploadPaymentAttachment,
  PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '@/hooks/useFinancialPayments';
import { useTenant } from '@/hooks/useTenant';
import type { Receivable } from '@/hooks/useReceivables';
import { Trash2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';

interface Props {
  receivable: Receivable | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const fmt = (v: number) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

export default function ReceivablePaymentDialog({ receivable, open, onOpenChange }: Props) {
  const { currentTenant } = useTenant();
  const { data: accounts = [] } = useBankAccounts();
  const { data: history = [] } = useReceivablePayments(receivable?.id ?? null);
  const register = useRegisterReceivablePayment();
  const reverse = useReverseReceivablePayment();
  const [amount, setAmount] = useState('');
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const remaining = receivable ? Number(receivable.amount) - Number(receivable.received_amount || 0) : 0;

  useEffect(() => {
    if (open && receivable) {
      setAmount(remaining > 0 ? remaining.toFixed(2) : '');
      setReceivedAt(new Date().toISOString().slice(0, 10));
      setNotes('');
      setFile(null);
      if (!bankAccountId && accounts.length > 0) setBankAccountId(accounts[0].id);
    }
  }, [open, receivable, accounts]); // eslint-disable-line

  const handleSubmit = async () => {
    if (!receivable || !currentTenant) return;
    const val = Number(amount);
    if (!val || val <= 0) { toast.error('Informe um valor válido'); return; }
    if (!bankAccountId) { toast.error('Selecione a conta bancária'); return; }
    try {
      let attachment_url: string | null = null;
      if (file) attachment_url = await uploadPaymentAttachment(currentTenant.id, 'receivable', file);
      await register.mutateAsync({
        receivable_id: receivable.id,
        amount: val,
        received_at: new Date(receivedAt + 'T12:00:00').toISOString(),
        bank_account_id: bankAccountId,
        method,
        notes: notes || null,
        attachment_url,
      });
      toast.success('Recebimento registrado');
      setAmount(''); setNotes(''); setFile(null);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Não foi possível registrar o recebimento.'));
    }
  };

  const handleReverse = async (id: string) => {
    if (!await confirmAction('Estornar este recebimento? A transação bancária vinculada também será removida.')) return;
    try {
      await reverse.mutateAsync(id);
      toast.success('Recebimento estornado');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Não foi possível estornar o recebimento.'));
    }
  };

  if (!receivable) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Recebimento — {receivable.invoice_number || receivable.description || 'Título'}</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Valor original</p>
            <p className="font-semibold">{fmt(Number(receivable.amount))}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Já recebido</p>
            <p className="font-semibold text-green-600">{fmt(Number(receivable.received_amount || 0))}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Em aberto</p>
            <p className="font-semibold text-warning">{fmt(remaining)}</p>
          </div>
        </div>

        {remaining > 0.005 && (
          <div className="space-y-3 border rounded-md p-3">
            <p className="text-sm font-medium">Novo recebimento</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor recebido (R$)</Label>
                <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Máx {fmt(remaining)} · valores menores geram baixa parcial
                </p>
              </div>
              <div>
                <Label>Data</Label>
                <Input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} />
              </div>
              <div>
                <Label>Conta bancária *</Label>
                <Select value={bankAccountId} onValueChange={setBankAccountId}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name}{a.bank_name ? ` — ${a.bank_name}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Forma</Label>
                <Select value={method} onValueChange={value => setMethod(value as PaymentMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Observação</Label>
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div>
              <Label>Comprovante (opcional)</Label>
              <Input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} />
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSubmit} disabled={register.isPending}>
                {register.isPending ? 'Registrando...' : 'Registrar recebimento'}
              </Button>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div className="border rounded-md p-3 space-y-2 max-h-64 overflow-y-auto">
            <p className="text-sm font-medium">Histórico</p>
            {history.map(h => (
              <div key={h.id} className="flex items-center justify-between text-sm border-b last:border-b-0 pb-2 last:pb-0">
                <div>
                  <p className="font-medium">{fmt(Number(h.amount))} <Badge variant="secondary" className="ml-2 text-[10px]">{PAYMENT_METHOD_LABELS[h.method as PaymentMethod] || h.method}</Badge></p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(h.received_at).toLocaleDateString('pt-BR')} · {h.bank_accounts?.name || '—'}
                    {h.notes ? ` · ${h.notes}` : ''}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleReverse(h.id)} className="text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
