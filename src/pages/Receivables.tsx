import {UnloadingCancellationDialog} from '@/components/financial/UnloadingCancellationDialog';
import {UnloadingOriginCorrectionDialog} from '@/components/financial/UnloadingOriginCorrectionDialog';
import {UnloadingProjectionRepairDialog} from '@/components/financial/UnloadingProjectionRepairDialog';
import {financialError} from '@/lib/financial/receivableCommands';
import {useReceivableUnloadingOrigin} from '@/hooks/useReceivableUnloadingOrigin';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import {ReceivableHistoryDialog} from '@/components/financial/ReceivableHistoryDialog';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { useListFilters } from '@/hooks/useListFilters';
import {useDebouncedValue} from '@/hooks/useDebouncedValue';
import { useState } from 'react';
import { useCreateReceivable, useUpdateReceivable, RECEIVABLE_STATUS_LABELS, RECEIVABLE_STATUSES } from '@/hooks/useReceivables';
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
import {useQuery} from '@tanstack/react-query';
import {readReceivablesPage} from '@/lib/financial/receivablesPageClient';
import {useReceivablePortfolio,portfolioValue} from '@/hooks/useReceivablePortfolio';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';

export default function Receivables() {
  const {currentTenant}=useTenant();const {user}=useAuth();
  return <ReceivablesScreen key={`${currentTenant?.id}:${user?.id}`}/>;
}
function ReceivablesScreen() {
  const toast = useSonnerToast();
  const [historyOpen,setHistoryOpen]=useState(false);
  const [repairCharge,setRepairCharge]=useState<string|null>(null);
  const [correctionCharge,setCorrectionCharge]=useState<string|null>(null);
  const [cancellationCharge,setCancellationCharge]=useState<string|null>(null);
  const {currentRole}=useTenant();
  const {currentTenant}=useTenant();const {user}=useAuth();
  const { data: clients = [] } = useClients();
  const createReceivable = useCreateReceivable();
  const updateReceivable = useUpdateReceivable();
  const { filters, setFilter, resetFilters, activeCount } = useListFilters({ search: '', status: 'all', client: 'all', origin:'all', from: '', to: '' });
  const { search, status: statusFilter } = filters;
  const settledSearch=useDebouncedValue(search);
  const searchPending=settledSearch!==search;
  const filterKey=JSON.stringify(filters);
  const [pagination,setPagination]=useState({key:'',page:1});
  const page=pagination.key===filterKey?pagination.page:1;
  const list=useQuery({queryKey:['receivables',currentTenant?.id,user?.id,'page',filters,page],queryFn:()=>readReceivablesPage(currentTenant!.id,filters,page),enabled:!!currentTenant&&!!user&&!searchPending,retry:false});
  const isLoading=searchPending||list.isPending||list.isFetching;
  const receivables=isLoading||list.isError?[]:list.data?.rows||[];
  const filtered=receivables;
  const portfolio=useReceivablePortfolio(currentTenant?.id,user?.id,{from:null,to:null,client:null});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    description: '', client_id: '', amount: '', due_date: '', invoice_number: '', notes: '', status: 'pending',
  });
  const [paymentReceivable, setPaymentReceivable] = useState<Receivable | null>(null);
  const originQuery=useReceivableUnloadingOrigin(currentTenant?.id,user?.id,dialogOpen?editingId:null);
  const originPending=!!editingId&&(originQuery.isPending||originQuery.isFetching||!!originQuery.error);
  const unloadingOrigin=originQuery.isFetching||originQuery.isError?null:originQuery.data;
  const editedReceivable=receivables.find(row=>row.id===editingId);
  const manualStatusAllowed=!originPending&&!unloadingOrigin&&(!editingId||!!editedReceivable)&&!editedReceivable?.client_invoice_id&&!Number(editedReceivable?.received_amount||0)&&['pending','cancelled'].includes(form.status);

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
    if(editingId&&originPending){toast.error('Confira a origem do título antes de salvar.');return;}
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
        await updateReceivable.mutateAsync(unloadingOrigin?{id:editingId,description:values.description,due_date:values.due_date,invoice_number:values.invoice_number,notes:values.notes}:{ id: editingId, ...values });
        toast.success('Título atualizado');
      } else {
        await createReceivable.mutateAsync(values);
        toast.success('Título criado');
      }
      resetForm();
    } catch (error) {
      const message=typeof error==='object'&&error!==null&&'message' in error?String(error.message):'';
      toast.error(message.startsWith('finance_unloading_')?financialError(error):getErrorMessage(error, 'Não foi possível salvar o título.'));
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
        <div className="flex gap-2">{currentTenant&&user&&<Button variant="outline" onClick={()=>setHistoryOpen(true)}>Histórico de alterações</Button>}<Button onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Novo Título
        </Button></div>
      </div>

      {historyOpen&&currentTenant&&user&&<ReceivableHistoryDialog key={`${currentTenant.id}:${user.id}`} tenant={currentTenant.id} actor={user.id} onClose={()=>setHistoryOpen(false)}/>}
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Saldo em aberto — títulos ativos</p>
          <p className="text-xl font-bold text-warning">{portfolioValue(portfolio,'open_cents')}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Vencido — títulos ativos</p>
          <p className="text-xl font-bold text-blue-600">{portfolioValue(portfolio,'overdue_cents')}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Baixas alocadas (inclui parciais)</p>
          <p className="text-xl font-bold text-green-600">{portfolioValue(portfolio,'received_allocated_cents')}</p>
        </CardContent></Card>
      </div>

      <ListFilterBar activeCount={activeCount} onReset={resetFilters} resultCount={list.data?.total||0} totalCount={list.data?.total_unfiltered||0} loading={isLoading} description="Indicadores da carteira completa, sem aplicar os filtros da lista. A lista é filtrada pelo vencimento." fields={[
        { key: 'search', label: 'Buscar título', type: 'search', placeholder: 'Descrição, fatura ou cliente', value: search, onChange: value => setFilter('search', value) },
        { key: 'status', label: 'Situação', value: statusFilter, onChange: value => setFilter('status', value), options: [{ value: 'all', label: 'Todas as situações' }, { value: 'overdue', label: 'Vencidos em aberto' }, ...RECEIVABLE_STATUSES.map(value => ({ value, label: RECEIVABLE_STATUS_LABELS[value] }))] },
        { key:'origin',label:'Origem',value:filters.origin,onChange:value=>setFilter('origin',value),options:[{value:'all',label:'Todas as origens'},{value:'unloading',label:'Reembolso de descarga'},{value:'fiscal',label:'Frete fiscal vinculado'},{value:'other',label:'Outros / sem vínculo fiscal'}]},
        { key: 'client', label: 'Cliente / fornecedor devedor', value: filters.client, onChange: value => setFilter('client', value), options: [{ value: 'all', label: 'Todos os devedores' }, ...clients.map(client => ({ value: client.id, label: client.company_name }))] },
        { key: 'from', label: 'Vencimento de', type: 'date', value: filters.from, onChange: value => setFilter('from', value), max: filters.to || undefined },
        { key: 'to', label: 'Vencimento até', type: 'date', value: filters.to, onChange: value => setFilter('to', value), min: filters.from || undefined },
      ]} />

      {list.isError&&<p role="alert">Não foi possível consultar os títulos. A falha não significa ausência de contas a receber. <Button variant="link" onClick={()=>void list.refetch()}>Tentar novamente</Button></p>}
      <div className="flex items-center gap-3"><Button variant="outline" disabled={isLoading||page===1} onClick={()=>setPagination({key:filterKey,page:page-1})}>Títulos anteriores</Button><span>Página {page} · até 50 títulos</span><Button variant="outline" disabled={isLoading||list.isError||page*50>=(list.data?.total||0)} onClick={()=>setPagination({key:filterKey,page:page+1})}>Próximos títulos</Button></div>
      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Cliente / fornecedor devedor</TableHead>
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
              ) : list.isError ? (<TableRow><TableCell colSpan={8} className="text-center py-8">Consulta indisponível</TableCell></TableRow>) : filtered.length === 0 ? (
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
            {!editingId||(!originPending&&!unloadingOrigin)?<div className="rounded-md border bg-muted/30 p-3">
              <FiscalXmlUpload perspective="receiver" onExtracted={(d) => applyXmlToForm(d)} />
            </div>:null}
            {originPending&&<p role="alert">{originQuery.error?"Não foi possível verificar a origem. O salvamento permanece bloqueado.":"Verificando a origem do título…"}{originQuery.error&&<Button variant="link" onClick={()=>void originQuery.refetch()}>Verificar origem novamente</Button>}</p>}
            {unloadingOrigin&&<div className="rounded border p-3"><p>Recebível de descarga · origem {unloadingOrigin.id} · entrega {unloadingOrigin.delivery_stop_id}</p><p>Fornecedor devedor original: {typeof unloadingOrigin.source_snapshot.supplier_name==="string"?unloadingOrigin.source_snapshot.supplier_name:"Nome preservado não informado"} · {unloadingOrigin.supplier_id}</p><p>Valor original da descarga: {formatFinanceCents(unloadingOrigin.amount_cents)}</p><p>Estes dados preservam a origem e podem diferir da cobrança vigente após uma alteração auditada. Consulte a conferência da cobrança para verificar a versão vigente.</p><p>Fornecedor, valor e status são protegidos pela origem. Apenas descrição, vencimento, referência e observações podem ser editados aqui.</p><Button variant="outline" onClick={()=>setRepairCharge(unloadingOrigin.id)}>Conferir reparação do título</Button>{['owner','admin'].includes(currentRole||'')&&<Button variant="outline" onClick={()=>setCorrectionCharge(unloadingOrigin.id)}>Corrigir cobrança da descarga</Button>}{['owner','admin'].includes(currentRole||'')&&<Button variant="outline" onClick={()=>setCancellationCharge(unloadingOrigin.id)}>Conferir cancelamento da descarga</Button>}</div>}
            <div><Label>Descrição</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cliente / fornecedor devedor</Label>
                <Select disabled={originPending||!!unloadingOrigin} value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Nº Fatura</Label><Input value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Valor (R$)</Label><Input disabled={originPending||!!unloadingOrigin} type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div><Label>Vencimento</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
            </div>
            <div>
              {manualStatusAllowed?<label className="block">Status do título manual<select className="h-10 w-full rounded border bg-background px-3" value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="pending">Pendente</option><option value="cancelled">Cancelado</option></select></label>:<p>Status: {RECEIVABLE_STATUS_LABELS[form.status as keyof typeof RECEIVABLE_STATUS_LABELS]||form.status}</p>}
              <p className="text-xs text-muted-foreground">Recebimentos e estornos alteram o status automaticamente. Use a ação de recebimentos para registrar valores.</p>
            </div>
            <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>Cancelar</Button>
              <Button disabled={originPending||updateReceivable.isPending||createReceivable.isPending} onClick={handleSave}>Salvar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {repairCharge&&currentTenant&&user&&<UnloadingProjectionRepairDialog key={`${currentTenant.id}:${user.id}:${repairCharge}`} tenant={currentTenant.id} actor={user.id} chargeId={repairCharge} onClose={()=>setRepairCharge(null)}/>}
      {correctionCharge&&currentTenant&&user&&<UnloadingOriginCorrectionDialog key={`${currentTenant.id}:${user.id}:${correctionCharge}`} tenant={currentTenant.id} actor={user.id} chargeId={correctionCharge} open onOpenChange={open=>{if(!open)setCorrectionCharge(null);}}/>}
      {cancellationCharge&&currentTenant&&user&&<UnloadingCancellationDialog key={`${currentTenant.id}:${user.id}:${cancellationCharge}`} tenant={currentTenant.id} actor={user.id} chargeId={cancellationCharge} open onOpenChange={open=>{if(!open)setCancellationCharge(null);}}/>}
      <ReceivablePaymentDialog
        receivable={paymentReceivable}
        open={!!paymentReceivable}
        onOpenChange={(o) => { if (!o) setPaymentReceivable(null); }}
      />
    </div>
  );
}
