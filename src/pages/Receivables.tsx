import { useState, useMemo } from 'react';
import { useReceivables, useCreateReceivable, useUpdateReceivable, RECEIVABLE_STATUS_LABELS, RECEIVABLE_STATUSES } from '@/hooks/useReceivables';
import { useClients } from '@/hooks/useClients';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Search, Plus, DollarSign, TrendingUp, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import FiscalXmlUpload from '@/components/financial/FiscalXmlUpload';
import ReceivablePaymentDialog from '@/components/financial/ReceivablePaymentDialog';
import type { Receivable } from '@/hooks/useReceivables';
import type { ParsedFiscalXml } from '@/lib/nfeXmlParser';

export default function Receivables() {
  const { data: receivables = [], isLoading } = useReceivables();
  const { data: clients = [] } = useClients();
  const createReceivable = useCreateReceivable();
  const updateReceivable = useUpdateReceivable();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    description: '', client_id: '', amount: '', due_date: '', invoice_number: '', notes: '', status: 'pending',
  });
  const [paymentReceivable, setPaymentReceivable] = useState<Receivable | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return receivables.filter((r: any) => {
      if (q && !(r.description || '').toLowerCase().includes(q) && !(r.invoice_number || '').toLowerCase().includes(q) && !(r.clients?.company_name || '').toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });
  }, [receivables, search, statusFilter]);

  const totals = useMemo(() => ({
    pending: receivables.filter((r: any) => r.status === 'pending').reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
    invoiced: receivables.filter((r: any) => r.status === 'invoiced').reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
    received: receivables.filter((r: any) => r.status === 'received').reduce((s: number, r: any) => s + Number(r.received_amount || r.amount || 0), 0),
  }), [receivables]);

  const resetForm = () => {
    setForm({ description: '', client_id: '', amount: '', due_date: '', invoice_number: '', notes: '', status: 'pending' });
    setEditingId(null);
    setDialogOpen(false);
  };

  const openEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      description: r.description || '',
      client_id: r.client_id || '',
      amount: r.amount ? String(r.amount) : '',
      due_date: r.due_date || '',
      invoice_number: r.invoice_number || '',
      notes: r.notes || '',
      status: r.status || 'pending',
    });
    setDialogOpen(true);
  };

  const applyXmlToForm = (data: ParsedFiscalXml) => {
    // Match client by CNPJ if possible (recipient of NFe = customer)
    const cnpj = data.recipient.tax_id;
    const match = cnpj
      ? clients.find((c: any) => (c.tax_id || '').replace(/\D/g, '') === cnpj)
      : null;
    setForm(prev => ({
      ...prev,
      description: data.description || prev.description,
      client_id: match?.id || prev.client_id,
      amount: data.amount ? String(data.amount) : prev.amount,
      due_date: data.first_due_date || data.issue_date || prev.due_date,
      invoice_number: data.document_number
        ? (data.series ? `${data.document_number}/${data.series}` : data.document_number)
        : prev.invoice_number,
      notes: [
        prev.notes,
        data.access_key ? `Chave NFe: ${data.access_key}` : null,
        !match && data.recipient.name ? `Cliente do XML: ${data.recipient.name}${cnpj ? ` (CNPJ ${cnpj})` : ''}` : null,
      ].filter(Boolean).join('\n'),
    }));
    if (cnpj && !match) toast.warning('Cliente do XML não encontrado no cadastro. Selecione manualmente.');
  };

  const handleSave = async () => {
    try {
      const values: any = {
        description: form.description || null,
        client_id: form.client_id || null,
        amount: form.amount ? Number(form.amount) : 0,
        due_date: form.due_date || null,
        invoice_number: form.invoice_number || null,
        notes: form.notes || null,
        status: form.status,
      };
      if (form.status === 'received') values.received_at = new Date().toISOString();
      if (editingId) {
        await updateReceivable.mutateAsync({ id: editingId, ...values });
        toast.success('Título atualizado');
      } else {
        await createReceivable.mutateAsync(values);
        toast.success('Título criado');
      }
      resetForm();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const statusColor = (s: string) => {
    if (s === 'received') return 'bg-green-500/10 text-green-600';
    if (s === 'partial') return 'bg-amber-500/10 text-amber-600';
    if (s === 'invoiced') return 'bg-blue-500/10 text-blue-600';
    if (s === 'cancelled') return 'bg-destructive/10 text-destructive';
    return 'bg-warning/10 text-warning';
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" /> Contas a Receber
          </h1>
          <p className="text-sm text-muted-foreground">Títulos financeiros vinculados a fretes e pedidos</p>
        </div>
        <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Novo Título
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Pendente</p>
          <p className="text-xl font-bold text-warning">{fmt(totals.pending)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Faturado</p>
          <p className="text-xl font-bold text-blue-600">{fmt(totals.invoiced)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Recebido</p>
          <p className="text-xl font-bold text-green-600">{fmt(totals.received)}</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {RECEIVABLE_STATUSES.map(s => <SelectItem key={s} value={s}>{RECEIVABLE_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Nº Fatura</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Recebido / Saldo</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-40">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum título encontrado</TableCell></TableRow>
              ) : filtered.map((r: any) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEdit(r)}>
                  <TableCell className="text-sm font-medium">{r.description || '—'}</TableCell>
                  <TableCell className="text-sm">{r.clients?.company_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.invoice_number || '—'}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{fmt(Number(r.amount || 0))}</TableCell>
                  <TableCell className="text-sm text-right">
                    <span className="text-green-600">{fmt(Number(r.received_amount || 0))}</span>
                    {' / '}
                    <span className="text-warning">{fmt(Math.max(0, Number(r.amount || 0) - Number(r.received_amount || 0)))}</span>
                  </TableCell>
                  <TableCell className="text-sm">{r.due_date ? new Date(r.due_date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</TableCell>
                  <TableCell><Badge className={statusColor(r.status)}>{r.status === 'partial' ? 'Parcial' : (RECEIVABLE_STATUS_LABELS[r.status as keyof typeof RECEIVABLE_STATUS_LABELS] || r.status)}</Badge></TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      {r.status !== 'received' && r.status !== 'cancelled' && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-green-600" onClick={() => setPaymentReceivable(r)}>
                          <DollarSign className="h-3.5 w-3.5 mr-1" /> Receber
                        </Button>
                      )}
                      {r.status === 'received' && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setPaymentReceivable(r)}>
                          <CheckCircle className="h-3.5 w-3.5 mr-1" /> Baixas
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

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={o => { if (!o) resetForm(); setDialogOpen(o); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? 'Editar Título' : 'Novo Título'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3">
              <FiscalXmlUpload perspective="receiver" onExtracted={(d) => applyXmlToForm(d)} />
            </div>
            <div><Label>Descrição</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cliente</Label>
                <Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Nº Fatura</Label><Input value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div><Label>Vencimento</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECEIVABLE_STATUSES.map(s => <SelectItem key={s} value={s}>{RECEIVABLE_STATUS_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>Cancelar</Button>
              <Button onClick={handleSave}>Salvar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ReceivablePaymentDialog
        receivable={paymentReceivable}
        open={!!paymentReceivable}
        onOpenChange={(o) => { if (!o) setPaymentReceivable(null); }}
      />
    </div>
  );
}
