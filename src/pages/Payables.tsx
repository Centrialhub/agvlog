import {PayableApprovalDialog} from '@/components/financial/PayableApprovalDialog';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { FinanceAccessBoundary } from '@/components/financial/FinanceAccessBoundary';
import { PayablePortfolioPanel } from '@/components/financial/PayablePortfolioPanel';
import {
  useCreatePayable, useUpdatePayable,
  PAYABLE_STATUSES, PAYABLE_STATUS_LABELS,
  PAYABLE_CATEGORIES, PAYABLE_CATEGORY_LABELS, type Payable,
} from '@/hooks/usePayables';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Wallet, Receipt } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import FiscalXmlUpload from '@/components/financial/FiscalXmlUpload';
import PayablePaymentDialog from '@/components/financial/PayablePaymentDialog';
import ManualExpenseDialog from '@/components/financial/ManualExpenseDialog';
import { useTenant } from '@/hooks/useTenant';
import type { ParsedFiscalXml } from '@/lib/nfeXmlParser';
import { getErrorMessage } from '@/lib/errors';
import { uploadSecureFile } from '@/lib/secureUpload';

const emptyForm = {
  supplier_name: '',
  category: 'supplier',
  description: '',
  amount: '',
  due_date: '',
  competence_date: '',
  document_number: '',
  status: 'pending',
  notes: '',
};

export default function Payables(){const {currentTenant}=useTenant();const {user}=useAuth();return <FinanceAccessBoundary>{currentTenant&&user&&<PayablesWorkspace key={`${currentTenant.id}:${user.id}`}/>}</FinanceAccessBoundary>;}
function PayablesWorkspace() {
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const {user}=useAuth();
  const [detailBusy,setDetailBusy]=useState(false),[detailError,setDetailError]=useState('');
  const request=useRef(0);
  useEffect(()=>()=>{request.current+=1;},[]);
  const createMut = useCreatePayable();
  const updateMut = useUpdatePayable();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [pendingReceipt, setPendingReceipt] = useState<File | null>(null);
  const [paymentPayable, setPaymentPayable] = useState<Payable | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [approvalId,setApprovalId]=useState<string|null>(null);
  const [originalStatus,setOriginalStatus]=useState<string|null>(null);

  const resetForm = () => {
    setForm({ ...emptyForm });
    setEditingId(null);
    setPendingReceipt(null);
    setDialogOpen(false);
  };

  const openEdit = (p: Payable) => {
    setEditingId(p.id);
    setOriginalStatus(p.status);
    setForm({
      supplier_name: p.supplier_name || '',
      category: p.category || 'supplier',
      description: p.description || '',
      amount: p.amount ? String(p.amount) : '',
      due_date: p.due_date || '',
      competence_date: p.competence_date || '',
      document_number: p.document_number || '',
      status: p.status || 'pending',
      notes: p.notes || '',
    });
    setPendingReceipt(null);
    setDialogOpen(true);
  };

  const applyXmlToForm = async (data: ParsedFiscalXml, file: File) => {
    setPendingReceipt(file);
    setForm(prev => ({
      ...prev,
      supplier_name: data.emitter.name || prev.supplier_name,
      description: data.description || prev.description,
      amount: data.amount ? String(data.amount) : prev.amount,
      due_date: data.first_due_date || data.issue_date || prev.due_date,
      competence_date: data.issue_date || prev.competence_date,
      document_number: data.document_number
        ? (data.series ? `${data.document_number}/${data.series}` : data.document_number)
        : prev.document_number,
      notes: [
        prev.notes,
        data.access_key ? `Chave NFe: ${data.access_key}` : null,
        data.emitter.tax_id ? `CNPJ: ${data.emitter.tax_id}` : null,
      ].filter(Boolean).join('\n'),
    }));
  };

  const uploadReceipt = async (file: File): Promise<string | null> => {
    if (!currentTenant) return null;
    return uploadSecureFile({
      tenantId: currentTenant.id,
      bucket: 'receipts',
      folder: 'payables',
      file,
      kind: 'financial',
    });
  };

  const handleSave = async () => {
    if (!form.supplier_name.trim()) {
      toast.error('Informe o fornecedor');
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      toast.error('Informe um valor válido');
      return;
    }
    try {
      let receiptPath: string | undefined;
      if (pendingReceipt) {
        try { receiptPath = (await uploadReceipt(pendingReceipt)) || undefined; }
        catch (error) { toast.error('Falha ao anexar XML: ' + getErrorMessage(error)); }
      }
      const values = {
        supplier_name: form.supplier_name.trim(),
        category: form.category,
        description: form.description || null,
        amount: Number(form.amount),
        due_date: form.due_date || null,
        competence_date: form.competence_date || null,
        document_number: form.document_number || null,
        status: form.status,
        notes: form.notes || null,
        receipt_url: receiptPath,
      };
      if (editingId) {
        const {status,...fields}=values;
        await updateMut.mutateAsync({ id: editingId, ...fields, ...(status!==originalStatus?{status}:{}) });
        toast.success('Conta atualizada');
      } else {
        await createMut.mutateAsync(values);
        toast.success('Conta criada');
      }
      resetForm();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Não foi possível salvar a conta.'));
    }
  };

  async function openAccount(id:string,action:'edit'|'payments'){
    if(!currentTenant)return;
    const generation=++request.current;setDetailBusy(true);setDetailError('');
    try{
      const {data,error}=await supabase.from('payables').select('*').eq('tenant_id',currentTenant.id).eq('id',id).single();
      if(error)throw error;
      if(!data||data.id!==id||data.tenant_id!==currentTenant.id)throw new Error('Conta fora da empresa solicitada.');
      if(generation!==request.current)return;
      if(action==='edit')openEdit(data);else setPaymentPayable(data);
    }catch(error){if(generation===request.current)setDetailError(getErrorMessage(error,'Não foi possível abrir esta conta.'));}
    finally{if(generation===request.current)setDetailBusy(false);}
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" /> Contas a Pagar
          </h1>
          <p className="text-sm text-muted-foreground">Fornecedores, despesas administrativas, impostos e adiantamentos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setManualOpen(true)}>
            <Receipt className="h-4 w-4 mr-2" /> Despesa avulsa
          </Button>
          <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Nova conta
          </Button>
        </div>
      </div>

      {detailBusy&&<p role="status">Abrindo conta selecionada…</p>}
      {detailError&&<p role="alert">{detailError}</p>}
      {currentTenant&&user&&<PayablePortfolioPanel tenant={currentTenant.id} actor={user.id} onOpen={(id,action)=>void openAccount(id,action)}/>}

      <Dialog open={dialogOpen} onOpenChange={o => { if (!o) resetForm(); setDialogOpen(o); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? 'Editar conta' : 'Nova conta a pagar'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3">
              <FiscalXmlUpload perspective="payer" onExtracted={applyXmlToForm} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fornecedor *</Label>
                <Input value={form.supplier_name} onChange={e => setForm({ ...form, supplier_name: e.target.value })} />
              </div>
              <div>
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYABLE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{PAYABLE_CATEGORY_LABELS[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Valor (R$) *</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <Label>Vencimento</Label>
                <Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
              </div>
              <div>
                <Label>Competência</Label>
                <Input type="date" value={form.competence_date} onChange={e => setForm({ ...form, competence_date: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nº documento</Label>
                <Input value={form.document_number} onChange={e => setForm({ ...form, document_number: e.target.value })} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYABLE_STATUSES.filter(s=>s!=='approved'||originalStatus==='approved'&&!!editingId).map(s => <SelectItem key={s} value={s} disabled={s==='approved'}>{PAYABLE_STATUS_LABELS[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>Cancelar</Button>
              {editingId&&<Button variant="outline" onClick={()=>{setApprovalId(editingId);resetForm();}}>Conferir aprovação</Button>}
              <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
                {editingId ? 'Salvar' : 'Criar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {approvalId&&currentTenant&&user&&<PayableApprovalDialog tenant={currentTenant.id} actor={user.id} payableId={approvalId} open onOpenChange={open=>{if(!open)setApprovalId(null);}}/>}
      <PayablePaymentDialog
        payable={paymentPayable}
        open={!!paymentPayable}
        onOpenChange={(o) => { if (!o) setPaymentPayable(null); }}
      />
      <ManualExpenseDialog open={manualOpen} onOpenChange={setManualOpen} />
    </div>
  );
}
