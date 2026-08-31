import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { useListFilters } from '@/hooks/useListFilters';
import { matchesSearch, matchesDateRange } from '@/lib/listFilters';
import { useState, useMemo } from 'react';
import { useReceivables, useCreateReceivable, useUpdateReceivable, RECEIVABLE_STATUS_LABELS, RECEIVABLE_STATUSES } from '@/hooks/useReceivables';
import { useClients } from '@/hooks/useClients';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, DollarSign, TrendingUp, CheckCircle } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import FiscalXmlUpload from '@/components/financial/FiscalXmlUpload';
import ReceivablePaymentDialog from '@/components/financial/ReceivablePaymentDialog';
import type { Receivable } from '@/hooks/useReceivables';
import type { ParsedFiscalXml } from '@/lib/nfeXmlParser';
import { getErrorMessage } from '@/lib/errors';
import {receivableTotals} from '@/lib/financial/receivableTotals';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';

export default function Receivables() {
  const {currentTenant}=useTenant();const {user}=useAuth();
  return <ReceivablesScreen key={`${currentTenant?.id}:${user?.id}`}/>;
}
function ReceivablesScreen() {
  const toast = useSonnerToast();
  const { data: receivables = [], isLoading } = useReceivables();
  const { data: clients = [] } = useClients();
  const createReceivable = useCreateReceivable();
  const updateReceivable = useUpdateReceivable();
  const { filters, setFilter, resetFilters, activeCount } = useListFilters({ search: '', status: 'all', client: 'all', from: '', to: '' });
  const { search, status: statusFilter } = filters;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    description: '', client_id: '', amount: '', due_date: '', invoice_number: '', notes: '', status: 'pending',
  });
  const [paymentReceivable, setPaymentReceivable] = useState<Receivable | null>(null);
  const editedReceivable=receivables.find(row=>row.id===editingId);
  const manualStatusAllowed=(!editingId||!!editedReceivable)&&!editedReceivable?.client_invoice_id&&!Number(editedReceivable?.received_amount||0)&&['pending','cancelled'].includes(form.status);

  const filtered = useMemo(() => receivables.filter(receivable =>
    matchesSearch(search, receivable.description, receivable.invoice_number, receivable.clients?.company_name) &&
    (statusFilter === 'all' || (statusFilter === 'overdue'
      ? Boolean(receivable.due_date) && new Date(receivable.due_date + 'T23:59:59') < new Date() && !['received', 'cancelled'].includes(receivable.status)
      : receivable.status === statusFilter)) &&
    (filters.client === 'all' || receivable.client_id === filters.client) &&
    matchesDateRange(receivable.due_date, filters.from, filters.to)
  ), [receivables, search, statusFilter, filters.client, filters.from, filters.to]);

  const totals = useMemo(() => receivableTotals(receivables), [receivables]);

  const resetForm = () => {
    setForm({ description: '', client_id: '', amount: '', due_date: '', invoice_number: '', notes: '', status: 'pending' });
    setEditingId(null);
    setDialogOpen(false);
  };

  const openEdit = (r: Receivable) => {
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
      ? clients.find(c => (c.tax_id || '').replace(/\D/g, '') === cnpj)
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
      const values = {
        description: form.description || null,
        client_id: form.client_id || null,
        amount: form.amount ? Number(form.amount) : 0,
        due_date: form.due_date || null,
        invoice_number: form.invoice_number || null,
        notes: form.notes || null,
        status: form.status,
      };
      if (editingId) {
        await updateReceivable.mutateAsync({ id: editingId, ...values });
        toast.success('Título atualizado');
      } else {
        await createReceivable.mutateAsync(values);
        toast.success('Título criado');
      }
      resetForm();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Não foi possível salvar o título.'));
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
          <p className="text-xs text-muted-foreground">Em aberto sem fatura</p>
          <p className="text-xl font-bold text-warning">{fmt(totals.pending)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Faturado em aberto</p>
          <p className="text-xl font-bold text-blue-600">{fmt(totals.invoiced)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Recebido líquido (inclui parciais)</p>
          <p className="text-xl font-bold text-green-600">{fmt(totals.received)}</p>
        </CardContent></Card>
      </div>

      <ListFilterBar activeCount={activeCount} onReset={resetFilters} resultCount={filtered.length} totalCount={receivables.length} loading={isLoading} description="Os indicadores acima mostram todos os títulos." fields={[
        { key: 'search', label: 'Buscar título', type: 'search', placeholder: 'Descrição, fatura ou cliente', value: search, onChange: value => setFilter('search', value) },
        { key: 'status', label: 'Situação', value: statusFilter, onChange: value => setFilter('status', value), options: [{ value: 'all', label: 'Todas as situações' }, { value: 'overdue', label: 'Vencidos em aberto' }, ...RECEIVABLE_STATUSES.map(value => ({ value, label: RECEIVABLE_STATUS_LABELS[value] }))] },
        { key: 'client', label: 'Cliente', value: filters.client, onChange: value => setFilter('client', value), options: [{ value: 'all', label: 'Todos os clientes' }, ...clients.map(client => ({ value: client.id, label: client.company_name }))] },
        { key: 'from', label: 'Vencimento de', type: 'date', value: filters.from, onChange: value => setFilter('from', value), max: filters.to || undefined },
        { key: 'to', label: 'Vencimento até', type: 'date', value: filters.to, onChange: value => setFilter('to', value), min: filters.from || undefined },
      ]} />

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
              ) : filtered.map(r => (
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
              {manualStatusAllowed?<label className="block">Status do título manual<select className="h-10 w-full rounded border bg-background px-3" value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="pending">Pendente</option><option value="cancelled">Cancelado</option></select></label>:<p>Status: {RECEIVABLE_STATUS_LABELS[form.status as keyof typeof RECEIVABLE_STATUS_LABELS]||form.status}</p>}
              <p className="text-xs text-muted-foreground">Recebimentos e estornos alteram o status automaticamente. Use a ação de recebimentos para registrar valores.</p>
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
