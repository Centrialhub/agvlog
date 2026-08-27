import { useState, useMemo } from 'react';
import {
  usePayables, useCreatePayable, useUpdatePayable,
  PAYABLE_STATUSES, PAYABLE_STATUS_LABELS,
  PAYABLE_CATEGORIES, PAYABLE_CATEGORY_LABELS, type Payable, type PayableStatus,
} from '@/hooks/usePayables';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Search, Plus, Wallet, Download, CheckCircle, XCircle, DollarSign, Receipt } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import FiscalXmlUpload from '@/components/financial/FiscalXmlUpload';
import PayablePaymentDialog from '@/components/financial/PayablePaymentDialog';
import ManualExpenseDialog from '@/components/financial/ManualExpenseDialog';
import { supabase } from '@/integrations/supabase/client';
import { validateUpload } from '@/lib/uploadPolicy';
import { useTenant } from '@/hooks/useTenant';
import type { ParsedFiscalXml } from '@/lib/nfeXmlParser';

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

function isOverdue(p: Payable) {
  if (!p.due_date) return false;
  if (p.status === 'paid' || p.status === 'cancelled') return false;
  return new Date(p.due_date + 'T23:59:59') < new Date();
}

export default function Payables() {
  const { data: payables = [], isLoading } = usePayables();
  const { currentTenant } = useTenant();
  const createMut = useCreatePayable();
  const updateMut = useUpdatePayable();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [pendingReceipt, setPendingReceipt] = useState<File | null>(null);
  const [paymentPayable, setPaymentPayable] = useState<Payable | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('all');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return payables.filter((p) => {
      if (q && !(p.supplier_name || '').toLowerCase().includes(q)
          && !(p.description || '').toLowerCase().includes(q)
          && !(p.document_number || '').toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all') {
        if (statusFilter === 'overdue' && !isOverdue(p)) return false;
        else if (statusFilter !== 'overdue' && p.status !== statusFilter) return false;
      }
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (sourceFilter !== 'all' && ((p as any).source || 'system') !== sourceFilter) return false;
      return true;
    });
  }, [payables, search, statusFilter, categoryFilter, sourceFilter]);

  const totals = useMemo(() => ({
    pending: payables.filter(p => p.status === 'pending').reduce((s, p) => s + Number(p.amount || 0), 0),
    approved: payables.filter(p => p.status === 'approved').reduce((s, p) => s + Number(p.amount || 0), 0),
    paid: payables.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount || 0), 0),
    overdue: payables.filter(isOverdue).reduce((s, p) => s + Number(p.amount || 0), 0),
  }), [payables]);

  const resetForm = () => {
    setForm({ ...emptyForm });
    setEditingId(null);
    setPendingReceipt(null);
    setDialogOpen(false);
  };

  const openEdit = (p: Payable) => {
    setEditingId(p.id);
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
    const { contentType, safeName } = validateUpload(file, 'financial');
    const path = `${currentTenant.id}/payables/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from('receipts').upload(path, file, { contentType });
    if (error) throw error;
    return path;
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
        catch (e: any) { toast.error('Falha ao anexar XML: ' + e.message); }
      }
      const values: any = {
        supplier_name: form.supplier_name.trim(),
        category: form.category,
        description: form.description || null,
        amount: Number(form.amount),
        due_date: form.due_date || null,
        competence_date: form.competence_date || null,
        document_number: form.document_number || null,
        status: form.status,
        notes: form.notes || null,
      };
      if (receiptPath) values.receipt_url = receiptPath;
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, ...values });
        toast.success('Conta atualizada');
      } else {
        await createMut.mutateAsync(values);
        toast.success('Conta criada');
      }
      resetForm();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const quickUpdate = async (p: Payable, status: string) => {
    try {
      await updateMut.mutateAsync({ id: p.id, status });
      toast.success('Conta atualizada');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Fornecedor', 'Categoria', 'Descrição', 'Documento', 'Vencimento', 'Competência', 'Valor', 'Status'],
      ...filtered.map(p => [
        p.supplier_name,
        PAYABLE_CATEGORY_LABELS[p.category] || p.category,
        p.description || '',
        p.document_number || '',
        p.due_date || '',
        p.competence_date || '',
        Number(p.amount || 0).toFixed(2).replace('.', ','),
        isOverdue(p) ? 'Vencida' : PAYABLE_STATUS_LABELS[p.status as PayableStatus] || p.status,
      ]),
    ];
    const csv = rows.map(r => r.map(cell => {
      const v = String(cell ?? '');
      return /[";\n,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contas-a-pagar-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  const statusColor = (p: Payable) => {
    if (isOverdue(p)) return 'bg-destructive/10 text-destructive';
    if (p.status === 'paid') return 'bg-green-500/10 text-green-600';
    if (p.status === 'approved') return 'bg-blue-500/10 text-blue-600';
    if (p.status === 'cancelled') return 'bg-muted text-muted-foreground';
    return 'bg-warning/10 text-warning';
  };

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
          <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-2" /> Exportar CSV
          </Button>
          <Button variant="outline" onClick={() => setManualOpen(true)}>
            <Receipt className="h-4 w-4 mr-2" /> Despesa avulsa
          </Button>
          <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Nova conta
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Pendente</p>
          <p className="text-xl font-bold text-warning">{fmt(totals.pending)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Aprovadas</p>
          <p className="text-xl font-bold text-blue-600">{fmt(totals.approved)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Vencidas</p>
          <p className="text-xl font-bold text-destructive">{fmt(totals.overdue)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Pagas</p>
          <p className="text-xl font-bold text-green-600">{fmt(totals.paid)}</p>
        </CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar fornecedor, doc..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="overdue">Vencidas</SelectItem>
            {PAYABLE_STATUSES.map(s => <SelectItem key={s} value={s}>{PAYABLE_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {PAYABLE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{PAYABLE_CATEGORY_LABELS[c]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Origem: todas</SelectItem>
            <SelectItem value="system">Operacional</SelectItem>
            <SelectItem value="manual">Avulsa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Pago / Saldo</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-40">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhuma conta encontrada.</TableCell></TableRow>
              ) : filtered.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEdit(p)}>
                  <TableCell className="text-sm font-medium">{p.supplier_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{PAYABLE_CATEGORY_LABELS[p.category] || p.category}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.document_number || '—'}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{fmt(Number(p.amount || 0))}</TableCell>
                  <TableCell className="text-sm text-right">
                    <span className="text-green-600">{fmt(Number((p as any).paid_amount || 0))}</span>
                    {' / '}
                    <span className="text-warning">{fmt(Math.max(0, Number(p.amount || 0) - Number((p as any).paid_amount || 0)))}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.due_date ? new Date(p.due_date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColor(p)}>
                      {isOverdue(p) ? 'Vencida' : (p.status === 'partial' ? 'Parcial' : (PAYABLE_STATUS_LABELS[p.status as PayableStatus] || p.status))}
                    </Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      {p.status !== 'paid' && p.status !== 'cancelled' && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-green-600" onClick={() => setPaymentPayable(p)}>
                          <DollarSign className="h-3.5 w-3.5 mr-1" /> Baixa
                        </Button>
                      )}
                      {p.status === 'paid' && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setPaymentPayable(p)}>
                          <CheckCircle className="h-3.5 w-3.5 mr-1" /> Baixas
                        </Button>
                      )}
                      {p.status !== 'cancelled' && p.status !== 'paid' && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive" onClick={() => quickUpdate(p, 'cancelled')}>
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
                    {PAYABLE_STATUSES.map(s => <SelectItem key={s} value={s}>{PAYABLE_STATUS_LABELS[s]}</SelectItem>)}
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
              <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
                {editingId ? 'Salvar' : 'Criar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <PayablePaymentDialog
        payable={paymentPayable}
        open={!!paymentPayable}
        onOpenChange={(o) => { if (!o) setPaymentPayable(null); }}
      />
      <ManualExpenseDialog open={manualOpen} onOpenChange={setManualOpen} />
    </div>
  );
}