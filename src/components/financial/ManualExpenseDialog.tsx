import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  useBankAccounts, useCreateManualExpense, uploadPaymentAttachment,
  PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
} from '@/hooks/useFinancialPayments';
import { PAYABLE_CATEGORIES, PAYABLE_CATEGORY_LABELS } from '@/hooks/usePayables';
import { useClients } from '@/hooks/useClients';
import { useTenant } from '@/hooks/useTenant';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const NONE = '__none__';

export default function ManualExpenseDialog({ open, onOpenChange }: Props) {
  const { currentTenant } = useTenant();
  const { data: accounts = [] } = useBankAccounts();
  const { data: clients = [] } = useClients();
  const create = useCreateManualExpense();

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('other');
  const [supplierId, setSupplierId] = useState<string>(NONE);
  const [supplierName, setSupplierName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [competenceDate, setCompetenceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [documentNumber, setDocumentNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [payNow, setPayNow] = useState(false);
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState('');
  const [method, setMethod] = useState('pix');
  const [file, setFile] = useState<File | null>(null);

  const suppliers = clients.filter((c: any) => c.is_supplier);

  useEffect(() => {
    if (open) {
      setDescription(''); setCategory('other'); setSupplierId(NONE); setSupplierName('');
      setAmount(''); setDueDate(''); setCompetenceDate(new Date().toISOString().slice(0, 10));
      setDocumentNumber(''); setNotes(''); setPayNow(false);
      setPaidAt(new Date().toISOString().slice(0, 10)); setMethod('pix'); setFile(null);
      if (accounts.length > 0) setBankAccountId(accounts[0].id);
    }
  }, [open, accounts]);

  const handleSave = async () => {
    if (!currentTenant) return;
    const val = Number(amount);
    if (!description.trim()) return toast.error('Informe a descrição');
    if (!val || val <= 0) return toast.error('Informe um valor válido');
    if (payNow && !bankAccountId) return toast.error('Selecione a conta bancária para pagamento imediato');

    try {
      let attachment_url: string | null = null;
      if (file) attachment_url = await uploadPaymentAttachment(currentTenant.id, 'payable', file);
      const resolvedSupplier = supplierId !== NONE
        ? (suppliers.find((s: any) => s.id === supplierId)?.company_name || 'Fornecedor')
        : (supplierName.trim() || 'Despesa avulsa');

      await create.mutateAsync({
        supplier_name: resolvedSupplier,
        supplier_id: supplierId !== NONE ? supplierId : null,
        category,
        description,
        amount: val,
        due_date: dueDate || null,
        competence_date: competenceDate || null,
        document_number: documentNumber || null,
        notes: notes || null,
        pay_now: payNow,
        paid_at: payNow ? new Date(paidAt + 'T12:00:00').toISOString() : null,
        bank_account_id: bankAccountId || null,
        method,
        attachment_url,
      });
      toast.success(payNow ? 'Despesa lançada e paga' : 'Despesa lançada');
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Nova despesa avulsa</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Descrição *</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex.: Tarifa bancária mensal" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYABLE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{PAYABLE_CATEGORY_LABELS[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fornecedor</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem fornecedor / Digitar</SelectItem>
                  {suppliers.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {supplierId === NONE && (
                <Input className="mt-2" placeholder="Nome (opcional)" value={supplierName} onChange={e => setSupplierName(e.target.value)} />
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Valor (R$) *</Label>
              <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Vencimento</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            <div>
              <Label>Competência</Label>
              <Input type="date" value={competenceDate} onChange={e => setCompetenceDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Nº documento / referência</Label>
            <Input value={documentNumber} onChange={e => setDocumentNumber(e.target.value)} />
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="border rounded-md p-3 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <Label className="mb-0">Já paga?</Label>
                <p className="text-xs text-muted-foreground">Gera baixa e lançamento bancário imediato.</p>
              </div>
              <Switch checked={payNow} onCheckedChange={setPayNow} />
            </div>
            {payNow && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Data pagamento</Label>
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
                <div>
                  <Label>Comprovante</Label>
                  <Input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={create.isPending}>
              {create.isPending ? 'Salvando...' : (payNow ? 'Lançar e pagar' : 'Lançar')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}