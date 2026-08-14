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
  useBankAccounts, useRegisterPayablePayment,
  usePayablePayments, useReversePayablePayment,
  uploadPaymentAttachment,
  PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
} from '@/hooks/useFinancialPayments';
import { useTenant } from '@/hooks/useTenant';
import type { Payable } from '@/hooks/usePayables';
import { Trash2 } from 'lucide-react';

interface Props {
  payable: Payable | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const fmt = (v: number) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

export default function PayablePaymentDialog({ payable, open, onOpenChange }: Props) {
  const { currentTenant } = useTenant();
  const { data: accounts = [] } = useBankAccounts();
  const { data: history = [] } = usePayablePayments(payable?.id ?? null);
  const register = useRegisterPayablePayment();
  const reverse = useReversePayablePayment();
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState('');
  const [method, setMethod] = useState<string>('pix');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const remaining = payable ? Number(payable.amount) - Number((payable as any).paid_amount || 0) : 0;

  useEffect(() => {
    if (open && payable) {
      setAmount(remaining > 0 ? remaining.toFixed(2) : '');
      setPaidAt(new Date().toISOString().slice(0, 10));
      setNotes('');
      setFile(null);
      if (!bankAccountId && accounts.length > 0) setBankAccountId(accounts[0].id);
    }
  }, [open, payable, accounts]); // eslint-disable-line

  const handleSubmit = async () => {
    if (!payable || !currentTenant) return;
    const val = Number(amount);
    if (!val || val <= 0) return toast.error('Informe um valor válido');
    if (!bankAccountId) return toast.error('Selecione a conta bancária');
    try {
      let attachment_url: string | null = null;
      if (file) attachment_url = await uploadPaymentAttachment(currentTenant.id, 'payable', file);
      await register.mutateAsync({
        payable_id: payable.id,
        amount: val,
        paid_at: new Date(paidAt + 'T12:00:00').toISOString(),
        bank_account_id: bankAccountId,
        method: method as any,
        notes: notes || null,
        attachment_url,
      });
      toast.success('Baixa registrada');
      setAmount(''); setNotes(''); setFile(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleReverse = async (id: string) => {
    if (!confirm('Estornar esta baixa? A transação bancária vinculada também será removida.')) return;
    try {
      await reverse.mutateAsync(id);
      toast.success('Baixa estornada');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (!payable) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Baixa — {payable.supplier_name}</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Valor original</p>
            <p className="font-semibold">{fmt(Number(payable.amount))}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Já pago</p>
            <p className="font-semibold text-green-600">{fmt(Number((payable as any).paid_amount || 0))}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Saldo</p>
            <p className="font-semibold text-warning">{fmt(remaining)}</p>
          </div>
        </div>

        {remaining > 0.005 && (
          <div className="space-y-3 border rounded-md p-3">
            <p className="text-sm font-medium">Nova baixa</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor pago (R$)</Label>
                <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Máx {fmt(remaining)} · valores menores geram baixa parcial
                </p>
              </div>
              <div>
                <Label>Data</Label>
                <Input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
              </div>
              <div>
                <Label>Conta bancária *</Label>
                <Select value={bankAccountId} onValueChange={setBankAccountId}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}{a.bank_name ? ` — ${a.bank_name}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Forma</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Observação</Label>
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex.: nº do comprovante" />
            </div>
            <div>
              <Label>Comprovante (opcional)</Label>
              <Input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} />
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSubmit} disabled={register.isPending}>
                {register.isPending ? 'Registrando...' : 'Registrar baixa'}
              </Button>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div className="border rounded-md p-3 space-y-2 max-h-64 overflow-y-auto">
            <p className="text-sm font-medium">Histórico de baixas</p>
            {history.map((h: any) => (
              <div key={h.id} className="flex items-center justify-between text-sm border-b last:border-b-0 pb-2 last:pb-0">
                <div>
                  <p className="font-medium">{fmt(Number(h.amount))} <Badge variant="secondary" className="ml-2 text-[10px]">{PAYMENT_METHOD_LABELS[h.method as PaymentMethodKey] || h.method}</Badge></p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(h.paid_at).toLocaleDateString('pt-BR')} · {h.bank_accounts?.name || '—'}
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

type PaymentMethodKey = keyof typeof PAYMENT_METHOD_LABELS;