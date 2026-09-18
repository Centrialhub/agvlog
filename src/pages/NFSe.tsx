import { useScopedAlerts } from '@/hooks/useAlertStore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Send, Ban, Edit, FileText, FilePlus2, Trash2, AlertCircle, RefreshCw, Clock, FileDown, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useNFSeList, useIssueNFSe, useCancelNFSe, useDeleteNFSe, useSyncNFSeStatus, useResendNFSe, fetchNfseHubRefs, type NFSeDoc } from '@/hooks/useNFSe';
import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import { runBulkDownload, summarizeBulkResult } from '@/lib/fiscal/bulkFileMerge';
import { fetchCachedFiscalBlob } from '@/lib/fiscal/fiscalFileValidation';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import NFSeFormDialog from '@/components/nfse/NFSeFormDialog';
import NFSeFromInvoicesDialog from '@/components/nfse/NFSeFromInvoicesDialog';
import { FiscalListPagination } from '@/components/fiscal/FiscalListPagination';
import { canCancelNFSeStatus, canRecoverNFSeStatus, isExactNFSeSelection, reconcileNFSeSelection, validateNFSeDateRange } from '@/lib/fiscal/nfseList';

type BadgeVariant = NonNullable<BadgeProps['variant']>;
type NfseHubRefs = Awaited<ReturnType<typeof fetchNfseHubRefs>>;
const STATUS_LABEL: Record<string, { label: string; variant: BadgeVariant }> = {
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
const DELETABLE_STATUSES = ['draft', 'rejected'];
const TABLE_PAGE_SIZE = 50;
const EMPTY_NFSE_DOCS: NFSeDoc[] = [];

const queryErrorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Não foi possível carregar as NFS-e.';

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
  const { promptAction, confirmAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const { data: queriedDocs, isLoading, isError, error, refetch, isFetching } = useNFSeList();
  const docs = useMemo(
    () => isError ? EMPTY_NFSE_DOCS : queriedDocs ?? EMPTY_NFSE_DOCS,
    [isError, queriedDocs],
  );
  const issue = useIssueNFSe();
  const cancel = useCancelNFSe();
  const del = useDeleteNFSe();
  const sync = useSyncNFSeStatus();
  const resend = useResendNFSe();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [seriesFilter, setSeriesFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const dateError = validateNFSeDateRange(dateFrom, dateTo);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [fromInvoicesOpen, setFromInvoicesOpen] = useState(false);
  const [editing, setEditing] = useState<NFSeDoc | null>(null);
  const [page, setPage] = useState(1);

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
  const downloadableIds = useMemo(() => downloadable.map(doc => doc.id).sort(), [downloadable]);
  const downloadableIdsKey = downloadableIds.join('|');
  const allDownloadableSelected = isExactNFSeSelection(checked, downloadableIds);
  useEffect(() => {
    setChecked(previous => {
      const reconciled = reconcileNFSeSelection(previous, downloadableIdsKey ? downloadableIdsKey.split('|') : []);
      if (reconciled.size === previous.size && [...reconciled].every(id => previous.has(id))) return previous;
      return reconciled;
    });
  }, [downloadableIdsKey]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleDocs = useMemo(
    () => filtered.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE),
    [filtered, currentPage],
  );

  function toggleRow(id: string) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function fetchNfseBlob(
    doc: NFSeDoc,
    format: 'pdf' | 'xml',
    knownRefs?: NfseHubRefs,
  ): Promise<Blob> {
    const cached = format === 'pdf' ? doc.pdf_url : doc.xml_url;
    if (cached) {
      try {
        return await fetchCachedFiscalBlob(cached, format);
      } catch { /* link expirado/CORS: tenta o proxy autenticado */ }
    }

    const refs = knownRefs ?? await fetchNfseHubRefs([doc.id]);
    const ref = refs.get(doc.id);
    if (ref) {
      return hubFiscal.file(ref.hubDocumentId, format, {
        type: 'nfse',
        emissionId: ref.emissionId,
      });
    }
    throw new Error('Sem arquivo no Hub Fiscal — sincronize o status da nota.');
  }

  async function downloadOne(doc: NFSeDoc, format: 'pdf' | 'xml') {
    const busyKey = `${doc.id}:${format}`;
    setDownloadBusy(busyKey);
    const label = doc.nfse_number || `RPS ${doc.rps_number}`;
    const toastId = toast.loading(`Baixando NFS-e ${label} (${format.toUpperCase()})...`);
    try {
      const blob = await fetchNfseBlob(doc, format);
      saveBlob(blob, `nfse-${doc.nfse_number || doc.rps_number || doc.id}.${format}`);
      toast.success(`NFS-e ${label} baixada`, { id: toastId });
    } catch (error: unknown) {
      const description = error instanceof Error ? error.message : 'Não foi possível baixar o arquivo.';
      toast.error('Falha ao baixar NFS-e', { id: toastId, description, duration: 12_000 });
    } finally {
      setDownloadBusy(null);
    }
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
        fetchOne: d => fetchNfseBlob(d, format, refs),
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
    } catch (error: unknown) {
      const description = error instanceof Error ? error.message : 'Não foi possível baixar os arquivos.';
      toast.error('Falha no download em massa', { id: toastId, description, duration: 12_000 });
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
    if (pendingCount === 0) return undefined;
    const tick = () => { if (!syncRef.current.isPending) syncRef.current.mutate({ silent: true }); };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [pendingCount]);

  const handleCancel = async (id: string) => {
    const reason = await promptAction('Informe por que esta NFS-e deve ser cancelada.', {
      title: 'Cancelar NFS-e',
      label: 'Motivo do cancelamento',
    });
    if (!reason) return;
    await cancel.mutateAsync({ id, reason });
  };

  const handleDelete = async (d: NFSeDoc) => {
    const label = d.nfse_number || `RPS ${d.rps_number}`;
    if (!await confirmAction(
      `Excluir ${label}? As NFs vinculadas voltam a ficar disponíveis para faturamento.`,
      { title: 'Excluir NFS-e', confirmLabel: 'Excluir' },
    )) return;
    await del.mutateAsync(d.id);
  };

  const rejectionText = (d: NFSeDoc) => {
    const message = d.rejection_messages;
    if (!message) return null;
    if (typeof message === 'string') return message;
    if (!Array.isArray(message) && typeof message === 'object') {
      const detail = message.message ?? message.error;
      if (typeof detail === 'string') return detail;
    }
    return JSON.stringify(message);
  };

  return (
    <div className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">NFS-e — Notas Fiscais de Serviço</h1>
            <p className="text-sm text-muted-foreground">Emissão, acompanhamento e gestão de RPS e NFS-e.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
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
            <Input className="max-w-xs" placeholder="Buscar nº, cliente, CNPJ…" value={search} onChange={e => { setSearch(e.target.value); setChecked(new Set()); setPage(1); }} />
          </CardHeader>
          <CardContent>
            {/* Filtros de seleção para download em massa */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</label>
                <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setChecked(new Set()); setPage(1); }}>
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
                <Select value={seriesFilter} onValueChange={v => { setSeriesFilter(v); setChecked(new Set()); setPage(1); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {seriesOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Emissão — de</label>
                <Input type="date" max={dateTo || undefined} value={dateFrom} onChange={e => { setDateFrom(e.target.value); setChecked(new Set()); setPage(1); }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Emissão — até</label>
                <Input type="date" min={dateFrom || undefined} value={dateTo} onChange={e => { setDateTo(e.target.value); setChecked(new Set()); setPage(1); }} />
              </div>
              <div className="flex items-end">
                <Button variant="outline" className="w-full" onClick={() => {
                  setStatusFilter('all'); setSeriesFilter('all'); setDateFrom(''); setDateTo(''); setSearch(''); setChecked(new Set()); setPage(1);
                }}>
                  <X className="h-4 w-4 mr-1" /> Limpar filtros
                </Button>
              </div>
            </div>
            {dateError ? <p role="alert" className="mb-3 text-sm text-destructive">{dateError}</p> : null}

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
                      checked={allDownloadableSelected}
                      onCheckedChange={() => setChecked(allDownloadableSelected ? new Set() : new Set(downloadableIds))}
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
                  <TableHead className="min-w-[260px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isError && <TableRow><TableCell colSpan={9} className="py-6"><div role="alert" className="mx-auto max-w-xl rounded-md border border-destructive/30 bg-destructive/10 p-4 text-center text-sm"><p>{queryErrorMessage(error)}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>Tentar novamente</Button></div></TableCell></TableRow>}
                {!isError && isLoading && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Carregando…</TableCell></TableRow>}
                {!isError && !isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Nenhuma NFS-e para os filtros selecionados</TableCell></TableRow>
                )}
                {!isError && visibleDocs.map(d => {
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
                          <Badge variant={st.variant}>{st.label}</Badge>
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
                                {d.last_status_check_at
                                  ? `Última consulta: ${new Date(d.last_status_check_at).toLocaleString('pt-BR')} (${d.status_check_attempts || 0} tentativas)`
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
                        {d.status === 'draft' && (
                          <Button size="sm" variant="outline" onClick={() => issue.mutate(d.id)} disabled={issue.isPending}>
                            <Send className="h-3 w-3 mr-1" /> Emitir
                          </Button>
                        )}
                        {canRecoverNFSeStatus(d.status) && (
                          <Button size="sm" variant="outline" onClick={() => resend.mutate(d.id)} disabled={resend.isPending}>
                            <RefreshCw className="h-3 w-3 mr-1" /> Recuperar
                          </Button>
                        )}
                        {ISSUED_STATUSES.includes(d.status) && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => downloadOne(d, 'pdf')}
                              disabled={downloadBusy !== null || bulkBusy}
                            >
                              <FileText className="h-3 w-3 mr-1" /> PDF
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => downloadOne(d, 'xml')}
                              disabled={downloadBusy !== null || bulkBusy}
                            >
                              <FileDown className="h-3 w-3 mr-1" /> XML
                            </Button>
                          </>
                        )}
                        {canCancelNFSeStatus(d.status) && (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => handleCancel(d.id)} 
                            disabled={cancel.isPending || d.status === 'transmitting'}
                          >
                            <Ban className="h-3 w-3 mr-1" /> Cancelar
                          </Button>
                        )}
                        {DELETABLE_STATUSES.includes(d.status) && (
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
            {!isError && <FiscalListPagination page={currentPage} pageSize={TABLE_PAGE_SIZE} totalItems={filtered.length} onPageChange={setPage} />}
          </CardContent>
        </Card>

        <NFSeFormDialog
          open={formOpen}
          onOpenChange={(next) => {
            setFormOpen(next);
            if (!next) setEditing(null);
          }}
          initial={editing}
          onSaved={() => setEditing(null)}
        />
        <NFSeFromInvoicesDialog open={fromInvoicesOpen} onOpenChange={setFromInvoicesOpen} />
    </div>
  );
}
