import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Send, Ban, Edit, FileText, FilePlus2, Trash2, AlertCircle, RefreshCw, Clock, FileDown, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useNFSeList, useIssueNFSe, useCancelNFSe, useDeleteNFSe, useSyncNFSeStatus, fetchNfseHubRefs, type NFSeDoc } from '@/hooks/useNFSe';
import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import { runBulkDownload, summarizeBulkResult } from '@/lib/fiscal/bulkFileMerge';
import { toast } from '@/components/ui/sonner';
import NFSeFormDialog from '@/components/nfse/NFSeFormDialog';
import NFSeFromInvoicesDialog from '@/components/nfse/NFSeFromInvoicesDialog';

const STATUS_LABEL: Record<string, { label: string; variant: any }> = {
  draft: { label: 'Rascunho', variant: 'secondary' },
  queued: { label: 'Em fila', variant: 'outline' },
  processing: { label: 'Processando', variant: 'outline' },
  issued: { label: 'Emitida', variant: 'default' },
  authorized: { label: 'Emitida', variant: 'default' },
  rejected: { label: 'Rejeitada', variant: 'destructive' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
  error: { label: 'Erro', variant: 'destructive' },
};

const PENDING_STATUSES = ['processing', 'queued', 'submitted', 'pending'];
const ISSUED_STATUSES = ['issued', 'authorized'];

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function NFSePage() {
  const { data: docs = [], isLoading } = useNFSeList();
  const issue = useIssueNFSe();
  const cancel = useCancelNFSe();
  const del = useDeleteNFSe();
  const sync = useSyncNFSeStatus();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [seriesFilter, setSeriesFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [fromInvoicesOpen, setFromInvoicesOpen] = useState(false);
  const [editing, setEditing] = useState<NFSeDoc | null>(null);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return docs.filter(d => {
      if (statusFilter === 'issued' && !ISSUED_STATUSES.includes(d.status)) return false;
      if (statusFilter !== 'issued' && statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (seriesFilter !== 'all' && (d.series || '') !== seriesFilter) return false;
      if (dateFrom && (d.issue_date || '') < dateFrom) return false;
      if (dateTo && (d.issue_date || '') > dateTo) return false;
      if (s && ![d.rps_number, d.nfse_number, d.cliente_nome, d.cliente_cnpj, d.reference_number]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(s))) return false;
      return true;
    });
  }, [docs, search, statusFilter, seriesFilter, dateFrom, dateTo]);

  const seriesOptions = useMemo(
    () => Array.from(new Set(docs.map(d => d.series || '').filter(Boolean))).sort(),
    [docs],
  );
  // Só notas emitidas/autorizadas têm arquivo no provedor.
  const downloadable = useMemo(() => filtered.filter(d => ISSUED_STATUSES.includes(d.status)), [filtered]);
  const checkedDocs = useMemo(() => downloadable.filter(d => checked.has(d.id)), [downloadable, checked]);

  function toggleRow(id: string) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function bulkDownload(format: 'pdf' | 'xml') {
    if (checkedDocs.length === 0) return;
    setBulkBusy(true);
    const total = checkedDocs.length;
    const toastId = toast.loading(`Preparando ${total} NFS-e (${format.toUpperCase()})...`);
    try {
      const refs = await fetchNfseHubRefs(checkedDocs.map(d => d.id));
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const result = await runBulkDownload({
        rows: checkedDocs,
        format,
        outputBase: `nfse-${format}-${stamp}`,
        labelOf: d => `NFS-e ${d.nfse_number || `RPS ${d.rps_number}`}`,
        filenameOf: d => `nfse-${d.nfse_number || d.rps_number || d.id}.${format}`,
        fetchOne: async d => {
          const ref = refs.get(d.id);
          if (ref) {
            return hubFiscal.file(ref.hubDocumentId, format, { type: 'nfse', emissionId: ref.emissionId });
          }
          const cached = format === 'pdf' ? d.pdf_url : d.xml_url;
          if (cached) {
            const res = await fetch(cached);
            if (res.ok) {
              const blob = await res.blob();
              if (blob.size > 0) return blob;
            }
          }
          throw new Error('Sem arquivo no Hub Fiscal — sincronize o status da nota.');
        },
        onProgress: (done, all, label) => {
          setBulkProgress({ done, total: all });
          toast.loading(`Baixando ${done}/${all} — ${label}`, { id: toastId });
        },
      });
      toast.loading(result.kind === 'pdf' ? 'Unindo tudo em um único PDF...' : 'Compactando arquivos...', { id: toastId });
      saveBlob(result.blob, result.filename);
      const summary = summarizeBulkResult(result, total);
      const fn = summary.tone === 'success' ? toast.success : summary.tone === 'error' ? toast.error : toast.warning;
      fn(summary.title, { id: toastId, description: summary.description, duration: 12_000 });
    } catch (e: any) {
      toast.error('Falha no download em massa', { id: toastId, description: e?.message, duration: 12_000 });
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  const pendingCount = useMemo(
    () => docs.filter(d => PENDING_STATUSES.includes(d.status)).length,
    [docs],
  );

  // Verificação automática: enquanto houver NFS-e em processamento, consulta o
  // provedor a cada 60s (a rotina do servidor roda a cada 5 min de forma independente).
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    if (pendingCount === 0) return;
    const tick = () => { if (!syncRef.current.isPending) syncRef.current.mutate({ silent: true }); };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [pendingCount]);

  const handleCancel = async (id: string) => {
    const reason = window.prompt('Motivo do cancelamento:');
    if (!reason) return;
    await cancel.mutateAsync({ id, reason });
  };

  const handleDelete = async (d: NFSeDoc) => {
    const label = d.nfse_number || `RPS ${d.rps_number}`;
    if (!window.confirm(`Excluir ${label}? As NFs vinculadas voltam a ficar disponíveis para faturamento.`)) return;
    await del.mutateAsync(d.id);
  };

  const rejectionText = (d: NFSeDoc) => {
    const m: any = d.rejection_messages;
    if (!m) return null;
    if (typeof m === 'string') return m;
    return m.message || m.error || JSON.stringify(m);
  };

  return (
    <div className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">NFS-e — Notas Fiscais de Serviço</h1>
            <p className="text-sm text-muted-foreground">Emissão de RPS / NFS-e (estrutura preparada para integração fiscal)</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => sync.mutate({})} disabled={sync.isPending}>
              <RefreshCw className={`h-4 w-4 mr-1 ${sync.isPending ? 'animate-spin' : ''}`} /> Consultar status
            </Button>
            <Button variant="outline" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> RPS avulso
            </Button>
            <Button onClick={() => setFromInvoicesOpen(true)}>
              <FilePlus2 className="h-4 w-4 mr-1" /> Emitir a partir de NFs
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Consulta — NFS-e</CardTitle>
            <Input className="max-w-xs" placeholder="Buscar nº, cliente, CNPJ…" value={search} onChange={e => setSearch(e.target.value)} />
          </CardHeader>
          <CardContent>
            {/* Filtros de seleção para download em massa */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</label>
                <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setChecked(new Set()); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="issued">Emitidas / autorizadas</SelectItem>
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="processing">Processando</SelectItem>
                    <SelectItem value="rejected">Rejeitada</SelectItem>
                    <SelectItem value="cancelled">Cancelada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Série</label>
                <Select value={seriesFilter} onValueChange={v => { setSeriesFilter(v); setChecked(new Set()); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {seriesOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Emissão — de</label>
                <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setChecked(new Set()); }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Emissão — até</label>
                <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setChecked(new Set()); }} />
              </div>
              <div className="flex items-end">
                <Button variant="outline" className="w-full" onClick={() => {
                  setStatusFilter('issued'); setSeriesFilter('all'); setDateFrom(''); setDateTo(''); setSearch(''); setChecked(new Set());
                }}>
                  <X className="h-4 w-4 mr-1" /> Limpar filtros
                </Button>
              </div>
            </div>

            {/* Barra de download em arquivo único */}
            <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border bg-muted/30 px-3 py-2 mb-3">
              <span className="text-sm text-muted-foreground">
                {bulkProgress
                  ? `Baixando ${bulkProgress.done}/${bulkProgress.total} do Hub Fiscal...`
                  : checkedDocs.length > 0
                    ? `${checkedDocs.length} NFS-e selecionada(s) — download em arquivo único`
                    : 'Filtre e selecione as NFS-e para baixar tudo em um único arquivo'}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={downloadable.length === 0 || bulkBusy}
                  onClick={() => setChecked(new Set(downloadable.map(d => d.id)))}>
                  Selecionar todas as filtradas ({downloadable.length})
                </Button>
                <Button size="sm" disabled={checkedDocs.length === 0 || bulkBusy} onClick={() => bulkDownload('pdf')}>
                  <FileText className="h-4 w-4 mr-1" /> Baixar PDF único
                </Button>
                <Button size="sm" variant="outline" disabled={checkedDocs.length === 0 || bulkBusy} onClick={() => bulkDownload('xml')}>
                  <FileDown className="h-4 w-4 mr-1" /> Baixar XMLs (ZIP)
                </Button>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={downloadable.length > 0 && checkedDocs.length === downloadable.length}
                      onCheckedChange={() => setChecked(prev =>
                        prev.size >= downloadable.length ? new Set() : new Set(downloadable.map(d => d.id)))}
                      aria-label="Selecionar todas"
                    />
                  </TableHead>
                  <TableHead>RPS / Nº NFS-e</TableHead>
                  <TableHead>Série</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Vl. Serviços</TableHead>
                  <TableHead className="text-right">ISS</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-44 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Carregando…</TableCell></TableRow>}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Nenhuma NFS-e para os filtros selecionados</TableCell></TableRow>
                )}
                {filtered.map(d => {
                  const st = STATUS_LABEL[d.status] || { label: d.status, variant: 'secondary' };
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Checkbox
                          checked={checked.has(d.id)}
                          disabled={!ISSUED_STATUSES.includes(d.status)}
                          onCheckedChange={() => toggleRow(d.id)}
                          aria-label="Selecionar NFS-e"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.nfse_number || `RPS ${d.rps_number}`}</TableCell>
                      <TableCell>{d.series}</TableCell>
                      <TableCell>{d.issue_date}</TableCell>
                      <TableCell className="max-w-[260px] truncate">{d.cliente_nome || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">R$ {Number(d.valor_servicos).toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">R$ {Number(d.valor_iss).toFixed(2)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant={st.variant as any}>{st.label}</Badge>
                          {rejectionText(d) && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">{rejectionText(d)}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {PENDING_STATUSES.includes(d.status) && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => sync.mutate({ id: d.id })} disabled={sync.isPending}>
                                  <Clock className="h-3 w-3 mr-1" /> Consultar
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {(d as any).last_status_check_at
                                  ? `Última consulta: ${new Date((d as any).last_status_check_at).toLocaleString('pt-BR')} (${(d as any).status_check_attempts || 0} tentativas)`
                                  : 'Nenhuma consulta automática realizada ainda'}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {d.status === 'draft' && (
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(d); setFormOpen(true); }}>
                            <Edit className="h-3 w-3" />
                          </Button>
                        )}
                        {(d.status === 'draft' || d.status === 'rejected' || d.status === 'error' || d.status === 'submitted' || d.status === 'processing') && (
                          <Button size="sm" variant="outline" onClick={() => issue.mutate(d.id)} disabled={issue.isPending}>
                            <Send className="h-3 w-3 mr-1" /> {d.status === 'draft' ? 'Emitir' : 'Reenviar'}
                          </Button>
                        )}
                        {d.status !== 'cancelled' && (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => handleCancel(d.id)} 
                            disabled={cancel.isPending || d.status === 'transmitting'}
                          >
                            <Ban className="h-3 w-3 mr-1" /> Cancelar
                          </Button>
                        )}
                        {(!['issued', 'authorized'].includes(d.status) || d.status === 'rejected' || d.status === 'error') && (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(d)} disabled={del.isPending}>
                            <Trash2 className="h-3 w-3 mr-1" /> Excluir
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <NFSeFormDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} />
        <NFSeFromInvoicesDialog open={fromInvoicesOpen} onOpenChange={setFromInvoicesOpen} />
    </div>
  );
}
