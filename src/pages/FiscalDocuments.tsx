import { useEffect, useState } from 'react';
import { DataPagination } from '@/components/ui/data-pagination';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useFiscalDocumentSummary,
  useFiscalDocumentsPage,
  useCreateFiscalDocument,
  useUpdateFiscalDocument,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  DOC_STATUSES,
  DOC_STATUS_LABELS,
  FiscalDocument,
  type CreateFiscalDocumentInput,
  type UpdateFiscalDocumentInput,
  DocType,
  DocStatus,
  type FiscalDocumentSummary,
} from '@/hooks/useFiscalDocuments';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useClients } from '@/hooks/useClients';
import type { Client } from '@/hooks/useClients';
import { useOrders } from '@/hooks/useOrders';
import type { Order } from '@/hooks/useOrders';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Search, Plus, FileText, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight,
  PackageCheck, Clock, XCircle, ExternalLink, ChevronDown, ChevronRight,
  DollarSign, Weight, Layers, RefreshCcw,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const PAGE_SIZE = 50;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha inesperada no documento fiscal';
}

/* ─── Summary Cards ─── */
function SummaryCards({ summary }: { summary: FiscalDocumentSummary }) {
  const cards = [
    { label: 'NF-e Entrada', value: summary.inboundCount, icon: ArrowDownToLine, color: 'text-emerald-500' },
    { label: 'CT-e / Saída', value: summary.outboundCount, icon: ArrowUpFromLine, color: 'text-blue-500' },
    { label: 'Pendentes', value: summary.pendingCount, icon: Clock, color: 'text-amber-500' },
    { label: 'Valor Total', value: summary.totalValue > 0 ? `R$ ${summary.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—', icon: DollarSign, color: 'text-primary' },
    { label: 'Peso Total', value: summary.totalWeight > 0 ? `${summary.totalWeight.toLocaleString('pt-BR')} kg` : '—', icon: Weight, color: 'text-muted-foreground' },
    { label: 'Paletes', value: summary.totalPallets, icon: Layers, color: 'text-muted-foreground' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map(c => (
        <Card key={c.label} className="border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <c.icon className={`h-5 w-5 shrink-0 ${c.color}`} />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate">{c.label}</p>
              <p className="text-lg font-semibold text-foreground">{c.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─── Form ─── */
interface FiscalDocumentFormState {
  document_type: DocType;
  invoice_number: string;
  access_key: string;
  client_id: string;
  remitter: string;
  recipient: string;
  issue_date: string;
  order_id: string;
  product_summary: string;
  pallet_count: number;
  weight_kg: string;
  value: string;
}

function DocForm({ clients, orders, onSave, onCancel }: {
  clients: Client[];
  orders: Order[];
  onSave: (value: CreateFiscalDocumentInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FiscalDocumentFormState>({
    document_type: 'inbound',
    invoice_number: '',
    access_key: '',
    client_id: '',
    remitter: '',
    recipient: '',
    issue_date: '',
    order_id: '',
    product_summary: '',
    pallet_count: 0,
    weight_kg: '',
    value: '',
  });

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Tipo *</Label>
          <Select value={form.document_type} onValueChange={value => setForm(formState => ({ ...formState, document_type: value as DocType }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Nº Nota Fiscal</Label>
          <Input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} />
        </div>
      </div>
      <div>
        <Label>Chave de Acesso</Label>
        <Input value={form.access_key} onChange={e => setForm(f => ({ ...f, access_key: e.target.value }))} placeholder="44 dígitos" maxLength={44} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Cliente</Label>
          <Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
            <SelectContent>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Pedido Vinculado</Label>
          <Select value={form.order_id} onValueChange={v => setForm(f => ({ ...f, order_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
            <SelectContent>
              {orders.map(o => <SelectItem key={o.id} value={o.id}>{o.order_number}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Remetente</Label><Input value={form.remitter} onChange={e => setForm(f => ({ ...f, remitter: e.target.value }))} /></div>
        <div><Label>Destinatário</Label><Input value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))} /></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div><Label>Data Emissão</Label><Input type="date" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} /></div>
        <div><Label>Paletes</Label><Input type="number" min={0} value={form.pallet_count} onChange={e => setForm(f => ({ ...f, pallet_count: parseInt(e.target.value) || 0 }))} /></div>
        <div><Label>Peso (kg)</Label><Input type="number" min={0} value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} /></div>
        <div><Label>Valor (R$)</Label><Input type="number" min={0} step="0.01" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} /></div>
      </div>
      <div><Label>Resumo dos Produtos</Label><Input value={form.product_summary} onChange={e => setForm(f => ({ ...f, product_summary: e.target.value }))} /></div>
      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSave({
          ...form,
          client_id: form.client_id || null,
          order_id: form.order_id || null,
          weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
          value: form.value ? Number(form.value) : null,
        })}>Salvar</Button>
      </div>
    </div>
  );
}

/* ─── Status helpers ─── */
const statusIcon = (s: string) => {
  if (s === 'confirmed') return <PackageCheck className="h-3.5 w-3.5" />;
  if (s === 'cancelled') return <XCircle className="h-3.5 w-3.5" />;
  return <Clock className="h-3.5 w-3.5" />;
};

const statusColor = (s: string) => {
  if (s === 'confirmed') return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
  if (s === 'cancelled') return 'bg-destructive/10 text-destructive border-destructive/20';
  return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
};

const typeIcon = (t: string) => {
  if (t === 'inbound') return <ArrowDownToLine className="h-3.5 w-3.5" />;
  if (t === 'outbound') return <ArrowUpFromLine className="h-3.5 w-3.5" />;
  return <ArrowLeftRight className="h-3.5 w-3.5" />;
};

const typeColor = (t: string) => {
  if (t === 'inbound') return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
  if (t === 'outbound') return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
  return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
};

/* ─── Expandable Row ─── */
function DocRow({ doc, onStatusChange }: { doc: FiscalDocument; onStatusChange: (id: string, status: DocStatus) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setExpanded(!expanded)}>
        <TableCell className="w-8">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={`gap-1 ${typeColor(doc.document_type)}`}>
            {typeIcon(doc.document_type)}
            {DOC_TYPE_LABELS[doc.document_type as DocType] || doc.document_type}
          </Badge>
        </TableCell>
        <TableCell className="font-mono font-medium text-sm">{doc.invoice_number || '—'}</TableCell>
        <TableCell className="text-sm">{doc.clients?.company_name || '—'}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {doc.issue_date ? format(new Date(doc.issue_date + 'T12:00:00'), 'dd/MM/yyyy') : '—'}
        </TableCell>
        <TableCell className="text-sm text-right">{doc.value ? `R$ ${Number(doc.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</TableCell>
        <TableCell className="text-sm text-right">{doc.pallet_count || 0}</TableCell>
        <TableCell className="text-sm text-right">{doc.weight_kg ? `${Number(doc.weight_kg).toLocaleString('pt-BR')}` : '—'}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            {doc.load_id && doc.loads?.load_number ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link to={`/loads/${doc.load_id}`} onClick={e => e.stopPropagation()}>
                      <Badge variant="outline" className="gap-1 text-primary border-primary/30 hover:bg-primary/10 transition-colors">
                        <ExternalLink className="h-3 w-3" />
                        {doc.loads.load_number}
                      </Badge>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>Ver carga {doc.loads.load_number}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : '—'}
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={`gap-1 ${statusColor(doc.status)}`}>
            {statusIcon(doc.status)}
            {DOC_STATUS_LABELS[doc.status as DocStatus] || doc.status}
          </Badge>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={10} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="space-y-2">
                <p><span className="text-muted-foreground">Remetente:</span> {doc.remitter || '—'}</p>
                <p><span className="text-muted-foreground">Destinatário:</span> {doc.recipient || '—'}</p>
                {doc.orders?.order_number && (
                  <p><span className="text-muted-foreground">Pedido:</span> {doc.orders.order_number}</p>
                )}
              </div>
              <div className="space-y-2">
                <p><span className="text-muted-foreground">Chave de Acesso:</span></p>
                <p className="font-mono text-xs break-all">{doc.access_key || '—'}</p>
                {doc.product_summary && (
                  <>
                    <p className="text-muted-foreground">Produtos:</p>
                    <p className="text-xs">{doc.product_summary}</p>
                  </>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-muted-foreground">Alterar Status:</p>
                <div className="flex gap-2 flex-wrap">
                  {DOC_STATUSES.filter(s => s !== doc.status).map(s => (
                    <Button
                      key={s}
                      size="sm"
                      variant="outline"
                      className={`text-xs ${statusColor(s)}`}
                      onClick={e => { e.stopPropagation(); onStatusChange(doc.id, s); }}
                    >
                      {statusIcon(s)}
                      <span className="ml-1">{DOC_STATUS_LABELS[s]}</span>
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Criado em {format(new Date(doc.created_at), 'dd/MM/yyyy HH:mm')}
                </p>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ─── Main Page ─── */
export default function FiscalDocuments() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: clients = [] } = useClients();
  const { data: orders = [] } = useOrders();
  const createDoc = useCreateFiscalDocument();
  const updateDoc = useUpdateFiscalDocument();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') || 'all');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
  const [loadFilter, setLoadFilter] = useState(searchParams.get('load') || 'all');
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1));
  const debouncedSearch = useDebouncedValue(search, 300);
  const {
    data: documentPage,
    isLoading,
    isError,
    error,
    refetch,
  } = useFiscalDocumentsPage({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch,
    typeFilter,
    statusFilter,
    loadFilter,
  });
  const docs = documentPage?.rows || [];
  const totalCount = documentPage?.totalCount || 0;
  const {
    data: summary = {
      totalCount: 0, inboundCount: 0, outboundCount: 0, pendingCount: 0,
      totalValue: 0, totalWeight: 0, totalPallets: 0,
    },
    isError: summaryFailed,
  } = useFiscalDocumentSummary();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = totalCount === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(safePage * PAGE_SIZE, totalCount);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, typeFilter, statusFilter, loadFilter]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch) next.set('q', debouncedSearch);
    if (typeFilter !== 'all') next.set('type', typeFilter);
    if (statusFilter !== 'all') next.set('status', statusFilter);
    if (loadFilter !== 'all') next.set('load', loadFilter);
    if (page > 1) next.set('page', String(page));
    setSearchParams(next, { replace: true });
  }, [debouncedSearch, loadFilter, page, setSearchParams, statusFilter, typeFilter]);

  const handleSave = async (values: CreateFiscalDocumentInput) => {
    try {
      await createDoc.mutateAsync(values);
      toast({ title: 'Documento fiscal criado com sucesso' });
      setDialogOpen(false);
    } catch (error: unknown) {
      toast({ title: 'Erro ao criar documento', description: errorMessage(error), variant: 'destructive' });
    }
  };

  const handleStatusChange = async (id: string, status: DocStatus) => {
    try {
      const update: UpdateFiscalDocumentInput = { id, status };
      await updateDoc.mutateAsync(update);
      toast({ title: `Status alterado para ${DOC_STATUS_LABELS[status]}` });
    } catch (error: unknown) {
      toast({ title: 'Erro ao atualizar', description: errorMessage(error), variant: 'destructive' });
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Controle Fiscal
          </h1>
          <p className="text-sm text-muted-foreground">
            {summary.totalCount} documentos • {totalCount} correspondem aos filtros
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Novo Documento</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Novo Documento Fiscal</DialogTitle>
              <DialogDescription>Cadastre a identificação, o vínculo e os totais do documento.</DialogDescription>
            </DialogHeader>
            <DocForm clients={clients} orders={orders} onSave={handleSave} onCancel={() => setDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI Cards */}
      {summaryFailed ? (
        <p role="alert" className="text-sm text-destructive">Não foi possível carregar o resumo fiscal.</p>
      ) : (
        <SummaryCards summary={summary} />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar NF, cliente, remetente, chave..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {DOC_STATUSES.map(s => <SelectItem key={s} value={s}>{DOC_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={loadFilter} onValueChange={setLoadFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as cargas</SelectItem>
            <SelectItem value="no_load">Sem carga</SelectItem>
            <SelectItem value="with_load">Com carga</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Tipo</TableHead>
                <TableHead>Nº NF</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Paletes</TableHead>
                <TableHead className="text-right">Peso (kg)</TableHead>
                <TableHead>Carga</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-12">Carregando...</TableCell></TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-12 text-center">
                    <div role="alert" className="flex flex-col items-center gap-3 text-destructive">
                      <span>Não foi possível carregar os documentos: {errorMessage(error)}.</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                        <RefreshCcw className="mr-2 h-4 w-4" /> Tentar novamente
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : docs.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-12">Nenhum documento encontrado</TableCell></TableRow>
              ) : docs.map(d => (
                <DocRow key={d.id} doc={d} onStatusChange={handleStatusChange} />
              ))}
            </TableBody>
          </Table>
          <DataPagination
            page={safePage}
            pageCount={pageCount}
            totalCount={totalCount}
            start={pageStart}
            end={pageEnd}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
