import { useScopedAlerts } from '@/hooks/useAlertStore';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterField as Field } from '@/components/ui/filter-field';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  useCteMonitor, useCteSefazEvents, useResendCte,
  SEFAZ_STATUS_LABELS, SEFAZ_STATUS_TONE, SEFAZ_STATUSES,
  type CteMonitorRow, type CteMonitorFilters, type SefazStatus,
} from '@/hooks/useCteMonitor';
import {
  FileText, FileDown, RefreshCw, Search, Filter as FilterIcon, X, AlertCircle, Eye, Ban,
} from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { useCancelCTe } from '@/hooks/useIssueCTe';
import { PendingInvoicesBanner } from '@/components/billing/PendingInvoicesBanner';
import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import { runBulkDownload, summarizeBulkResult } from '@/lib/fiscal/bulkFileMerge';
import { useSortableData } from '@/hooks/useSortableData';
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from '@/components/ui/table';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Falha inesperada';

function saveBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

function openBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const win = window.open(objectUrl, '_blank');
  if (!win) {
    // Pop-up bloqueado: entrega o arquivo já baixado como download.
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/** Obtém o arquivo do CT-e (sob demanda no Hub, ou link em cache como último recurso). */
async function fetchRowBlob(row: CteMonitorRow, format: 'pdf' | 'xml'): Promise<Blob> {
  if (row.hub_document_id) {
    return hubFiscal.file(row.hub_document_id, format, { type: 'cte', emissionId: row.emission_id });
  }
  const cachedUrl = format === 'pdf' ? row.pdf_url : row.xml_url;
  if (cachedUrl) {
    const res = await fetch(cachedUrl);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) return blob;
    }
  }
  throw new Error(
    row.source === 'hub'
      ? 'Sem id do Hub Fiscal — sincronize a emissão antes de baixar.'
      : 'Rascunho local nunca transmitido ao Hub Fiscal/SEFAZ.',
  );
}

async function downloadHubFile(
  toast: ReturnType<typeof useSonnerToast>,
  row: CteMonitorRow,
  format: 'pdf' | 'xml',
  opts: { silent?: boolean; view?: boolean } = {},
) {
  const label = format === 'pdf' ? 'PDF (DACTE)' : 'XML';
  const cachedUrl = format === 'pdf' ? row.pdf_url : row.xml_url;
  const filename = `cte-${row.access_key || row.cte_number || row.id}.${format}`;

  // O arquivo é sempre pedido SOB DEMANDA ao Hub Fiscal (deliver -> links -> file),
  // então o cliente consegue baixar quando quiser, mesmo sem cache.
  // Link em cache só é usado quando o registro não tem id no Hub.
  if (!row.hub_document_id) {
    if (cachedUrl) {
      try {
        const res = await fetch(cachedUrl);
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 0) {
            if (opts.view) openBlob(blob, filename); else saveBlob(blob, filename);
            return;
          }
        }
      } catch { /* segue para a mensagem de indisponível */ }
    }
    const description =
      row.source === 'hub'
        ? 'Este CT-e ainda não tem id do Hub Fiscal — sincronize a emissão antes de baixar.'
        : 'Este registro é um rascunho local que nunca foi transmitido ao Hub Fiscal/SEFAZ.';
    if (opts.silent) throw new Error(description);
    toast.error(`${label} indisponível`, { description });
    return;
  }
  const action = opts.view ? 'Abrindo' : 'Baixando';
  const toastId = opts.silent ? undefined : toast.loading(`${action} ${label}...`);
  try {
    const blob = await hubFiscal.file(row.hub_document_id, format, {
      type: 'cte',
      emissionId: row.emission_id,
    });
    if (opts.view) openBlob(blob, filename); else saveBlob(blob, filename);
    if (!opts.silent) toast.success(`${label} ${opts.view ? 'aberto' : 'baixado'}`, { id: toastId });
  } catch (error: unknown) {
    if (opts.silent) throw error;
    toast.error(`Falha ao ${opts.view ? 'abrir' : 'baixar'} ${label}`, { id: toastId, description: errorMessage(error) });
  }
}

const TONE_CLASS: Record<string, string> = {
  default: 'bg-secondary text-secondary-foreground',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  danger: 'bg-destructive/15 text-destructive border border-destructive/30',
  muted: 'bg-muted text-muted-foreground',
};

function StatusPill({ status }: { status: SefazStatus }) {
  const tone = SEFAZ_STATUS_TONE[status] ?? 'default';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {SEFAZ_STATUS_LABELS[status] ?? status}
    </span>
  );
}

// Mostra todos os status por padrão — CT-es autorizadas (processed) precisam
// aparecer no monitor para download de PDF/XML.
const DEFAULT_STATUSES: SefazStatus[] = [];

export default function CteMonitor() {
  const toast = useSonnerToast();
  const [filters, setFilters] = useState<CteMonitorFilters>({
    statuses: DEFAULT_STATUSES,
    correctionLetter: 'all',
  });
  const [draft, setDraft] = useState<CteMonitorFilters>(filters);
  const [selected, setSelected] = useState<CteMonitorRow | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const { data: rowsData = [], isLoading, refetch, isFetching } = useCteMonitor(filters);
  const resend = useResendCte();

  const { sortedItems: rows, requestSort, sortConfig } = useSortableData(rowsData);

  const downloadableRows = useMemo(() => rows.filter((r) => r.hub_document_id || r.pdf_url || r.xml_url), [rows]);
  const checkedRows = useMemo(() => rows.filter((r) => checked.has(r.id)), [rows, checked]);

  function toggleRow(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) =>
      prev.size === downloadableRows.length ? new Set() : new Set(downloadableRows.map((r) => r.id)),
    );
  }

  async function bulkDownload(format: 'pdf' | 'xml') {
    if (checkedRows.length === 0) return;
    setBulkBusy(true);
    const total = checkedRows.length;
    const toastId = toast.loading(`Baixando ${total} documento(s) ${format.toUpperCase()} do Hub Fiscal...`);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    try {
      const result = await runBulkDownload({
        rows: checkedRows,
        format,
        outputBase: `ctes-${format}-${stamp}`,
        fetchOne: (row) => fetchRowBlob(row, format),
        labelOf: (row) => `CT-e ${row.cte_number || row.access_key || row.id.slice(0, 8)}`,
        filenameOf: (row) => `cte-${row.access_key || row.cte_number || row.id}.${format}`,
        onProgress: (doneCount, all, label) => {
          setBulkProgress({ done: doneCount, total: all });
          toast.loading(`Baixando ${doneCount}/${all} — ${label}`, { id: toastId });
        },
      });
      toast.loading(
        result.kind === 'pdf' ? 'Unindo tudo em um único PDF...' : 'Compactando arquivos...',
        { id: toastId },
      );
      saveBlob(result.blob, result.filename);
      const summary = summarizeBulkResult(result, total);
      const fn = summary.tone === 'success' ? toast.success : summary.tone === 'error' ? toast.error : toast.warning;
      fn(summary.title, { id: toastId, description: summary.description, duration: 12_000 });
    } catch (error: unknown) {
      toast.error('Falha no download em massa', { id: toastId, description: errorMessage(error), duration: 12_000 });
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  const counts = useMemo(() => {
    const c = { total: rows.length, errors: 0, processed: 0, pending: 0, cancelled: 0 };
    for (const r of rows) {
      if (r.sefaz_status.endsWith('_error')) c.errors++;
      else if (r.sefaz_status === 'processed') c.processed++;
      else if (r.sefaz_status === 'pending') c.pending++;
      else if (r.sefaz_status === 'cancelled') c.cancelled++;
    }
    return c;
  }, [rows]);

  function applyFilters() {
    setFilters(draft);
  }
  function clearFilters() {
    const cleared: CteMonitorFilters = { statuses: DEFAULT_STATUSES, correctionLetter: 'all' };
    setDraft(cleared);
    setFilters(cleared);
    setChecked(new Set());
  }

  function toggleStatus(s: SefazStatus) {
    const cur = new Set(draft.statuses ?? []);
    if (cur.has(s)) cur.delete(s);
    else cur.add(s);
    setDraft({ ...draft, statuses: Array.from(cur) });
  }

  async function downloadXml(row: CteMonitorRow) {
    await downloadHubFile(toast, row, 'xml');
  }
  async function downloadPdf(row: CteMonitorRow) {
    await downloadHubFile(toast, row, 'pdf');
  }

  return (
    <>
      <div className="flex flex-col gap-4 p-4">
        <PendingInvoicesBanner from="monitor" />
        <header className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Monitor DOC-e (CT-e)</h1>
            <p className="text-sm text-muted-foreground">
              Acompanhamento dos CT-e enviados à SEFAZ — status, motivo de erro, PDF/XML e histórico de eventos.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{counts.total} registro(s)</Badge>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>
        </header>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-2xl font-semibold">{counts.total}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Processados</p>
            <p className="text-2xl font-semibold text-emerald-600">{counts.processed}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Erros</p>
            <p className="text-2xl font-semibold text-destructive">{counts.errors}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Pendentes</p>
            <p className="text-2xl font-semibold">{counts.pending}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Cancelados</p>
            <p className="text-2xl font-semibold text-muted-foreground">{counts.cancelled}</p>
          </Card>
        </div>

        {/* Filtros */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <FilterIcon className="h-4 w-4" />
            <h2 className="font-medium">Filtros</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Field label="Nº Doc">
              <Input value={draft.docNumber ?? ''} onChange={(e) => setDraft({ ...draft, docNumber: e.target.value })} />
            </Field>
            <Field label="Pagador">
              <Input value={draft.payer ?? ''} onChange={(e) => setDraft({ ...draft, payer: e.target.value })} />
            </Field>
            <Field label="Nº Interno">
              <Input value={draft.internalNumber ?? ''} onChange={(e) => setDraft({ ...draft, internalNumber: e.target.value })} />
            </Field>
            <Field label="Nº Compensação / Ref.">
              <Input value={draft.referenceNumber ?? ''} onChange={(e) => setDraft({ ...draft, referenceNumber: e.target.value })} />
            </Field>
            <Field label="Nº Protocolo">
              <Input value={draft.protocolNumber ?? ''} onChange={(e) => setDraft({ ...draft, protocolNumber: e.target.value })} />
            </Field>
            <Field label="Chave de Acesso (44)">
              <Input value={draft.accessKey ?? ''} onChange={(e) => setDraft({ ...draft, accessKey: e.target.value })} />
            </Field>
            <Field label="Placa">
              <Input value={draft.plate ?? ''} onChange={(e) => setDraft({ ...draft, plate: e.target.value })} />
            </Field>
            <Field label="Motorista">
              <Input value={draft.driver ?? ''} onChange={(e) => setDraft({ ...draft, driver: e.target.value })} />
            </Field>
            <Field label="Série">
              <Input value={draft.series ?? ''} onChange={(e) => setDraft({ ...draft, series: e.target.value })} />
            </Field>
            <Field label="Filial">
              <Input value={draft.branch ?? ''} onChange={(e) => setDraft({ ...draft, branch: e.target.value })} />
            </Field>
            <Field label="Grupo Empresa">
              <Input value={draft.companyGroup ?? ''} onChange={(e) => setDraft({ ...draft, companyGroup: e.target.value })} />
            </Field>
            <Field label="Grupo Pagador">
              <Input value={draft.payerGroup ?? ''} onChange={(e) => setDraft({ ...draft, payerGroup: e.target.value })} />
            </Field>
            <Field label="Processamento — Início">
              <Input type="date" value={draft.processedStart ?? ''} onChange={(e) => setDraft({ ...draft, processedStart: e.target.value })} />
            </Field>
            <Field label="Processamento — Fim">
              <Input type="date" value={draft.processedEnd ?? ''} onChange={(e) => setDraft({ ...draft, processedEnd: e.target.value })} />
            </Field>
            <Field label="Emissão — Início">
              <Input type="date" value={draft.issuedStart ?? ''} onChange={(e) => setDraft({ ...draft, issuedStart: e.target.value })} />
            </Field>
            <Field label="Emissão — Fim">
              <Input type="date" value={draft.issuedEnd ?? ''} onChange={(e) => setDraft({ ...draft, issuedEnd: e.target.value })} />
            </Field>
          </div>

          {/* Status checkboxes */}
          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Status (DOC-e)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {SEFAZ_STATUSES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={(draft.statuses ?? []).includes(s)}
                    onCheckedChange={() => toggleStatus(s)}
                  />
                  <span>{SEFAZ_STATUS_LABELS[s]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Carta de correção */}
          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Carta de Correção</span>
            {(['all', 'yes', 'no'] as const).map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="cce"
                  checked={(draft.correctionLetter ?? 'all') === v}
                  onChange={() => setDraft({ ...draft, correctionLetter: v })}
                />
                <span>{v === 'all' ? 'Todos' : v === 'yes' ? 'Sim' : 'Não'}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button onClick={applyFilters} size="sm">
              <Search className="h-4 w-4" /> Aplicar filtros
            </Button>
            <Button onClick={clearFilters} variant="outline" size="sm">
              <X className="h-4 w-4" /> Limpar
            </Button>
          </div>
        </Card>

        {/* Tabela */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap border-b bg-muted/30 px-3 py-2">
            <span className="text-sm text-muted-foreground">
              {bulkProgress
                ? `Baixando ${bulkProgress.done}/${bulkProgress.total} do Hub Fiscal...`
                : checkedRows.length > 0
                  ? `${checkedRows.length} CT-e(s) selecionado(s) — download em arquivo único`
                  : 'Filtre e selecione CT-es para baixar tudo em um único arquivo'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={downloadableRows.length === 0 || bulkBusy}
                onClick={() => setChecked(new Set(downloadableRows.map((r) => r.id)))}
              >
                Selecionar todos os filtrados ({downloadableRows.length})
              </Button>
              <Button
                size="sm"
                disabled={checkedRows.length === 0 || bulkBusy}
                onClick={() => bulkDownload('pdf')}
              >
                <FileText className="h-4 w-4" /> Baixar PDF único
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={checkedRows.length === 0 || bulkBusy}
                onClick={() => bulkDownload('xml')}
              >
                <FileDown className="h-4 w-4" /> Baixar XMLs (ZIP)
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50 text-xs uppercase">
                <TableRow>
                  <TableHead className="px-3 py-2 w-8">
                    <Checkbox
                      checked={downloadableRows.length > 0 && checked.size === downloadableRows.length}
                      onCheckedChange={toggleAll}
                      aria-label="Selecionar todos"
                    />
                  </TableHead>
                  <TableHead className="px-3 py-2" sortKey="sefaz_status" sortConfig={sortConfig} onSort={requestSort}>Status</TableHead>
                  <TableHead className="px-3 py-2" sortKey="cte_number" sortConfig={sortConfig} onSort={requestSort}>Nº CT-e</TableHead>
                  <TableHead className="px-3 py-2" sortKey="cte_series" sortConfig={sortConfig} onSort={requestSort}>Série</TableHead>
                  <TableHead className="px-3 py-2" sortKey="payer_name" sortConfig={sortConfig} onSort={requestSort}>Pagador</TableHead>
                  <TableHead className="px-3 py-2" sortKey="recipient_city" sortConfig={sortConfig} onSort={requestSort}>Cidade / UF</TableHead>
                  <TableHead className="px-3 py-2" sortKey="vehicle_plate" sortConfig={sortConfig} onSort={requestSort}>Placa</TableHead>
                  <TableHead className="px-3 py-2" sortKey="protocol_number" sortConfig={sortConfig} onSort={requestSort}>Protocolo</TableHead>
                  <TableHead className="px-3 py-2" sortKey="issued_at" sortConfig={sortConfig} onSort={requestSort}>Emissão</TableHead>
                  <TableHead className="px-3 py-2" sortKey="sefaz_status_reason" sortConfig={sortConfig} onSort={requestSort}>Motivo / Erro</TableHead>
                  <TableHead className="text-right px-3 py-2">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
                )}
                {!isLoading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">Nenhum CT-e encontrado para os filtros informados.</TableCell></TableRow>

                )}
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => setSelected(r)}
                  >
                    <TableCell className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={checked.has(r.id)}
                        onCheckedChange={() => toggleRow(r.id)}
                        disabled={!r.hub_document_id && !r.pdf_url && !r.xml_url}
                        aria-label="Selecionar CT-e"
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2"><StatusPill status={r.sefaz_status} /></TableCell>
                    <TableCell className="px-3 py-2 font-mono">{r.cte_number ?? '—'}</TableCell>
                    <TableCell className="px-3 py-2">{r.cte_series ?? '—'}</TableCell>
                    <TableCell className="px-3 py-2">{r.payer_name ?? r.recipient ?? '—'}</TableCell>
                    <TableCell className="px-3 py-2 text-xs truncate max-w-[200px]" title={`${r.recipient_city} / ${r.recipient_state}`}>
                      {r.recipient_city ?? '—'} / {r.recipient_state ?? '—'}
                    </TableCell>
                    <TableCell className="px-3 py-2 font-mono">{r.vehicle_plate ?? '—'}</TableCell>
                    <TableCell className="px-3 py-2 font-mono text-xs">{r.protocol_number ?? '—'}</TableCell>
                    <TableCell className="px-3 py-2 text-xs">
                      {r.issued_at ? new Date(r.issued_at).toLocaleDateString('pt-BR') : '—'}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-xs max-w-xs truncate" title={r.sefaz_status_reason ?? ''}>
                      {r.sefaz_status_reason ? (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <AlertCircle className="h-3 w-3" /> {r.sefaz_status_reason}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" title="Visualizar DACTE (PDF)" onClick={() => downloadHubFile(toast, r, 'pdf', { view: true })}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Baixar PDF (DACTE)" onClick={() => downloadPdf(r)}>
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Baixar XML" onClick={() => downloadXml(r)}>
                          <FileDown className="h-4 w-4" />
                        </Button>
                        {r.sefaz_status.endsWith('_error') && (
                          <Button size="sm" variant="ghost" title="Consultar/recuperar operação" onClick={() => resend.mutate(r.id, {
                            onSuccess: () => toast.success('Operação fiscal consultada e recuperada'),
                            onError: (error: unknown) => toast.error(errorMessage(error)),
                          })}>
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
          <DialogContent className="max-w-3xl">
            {selected && <CteDetail row={selected} onClose={() => setSelected(null)} />}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

function CteDetail({ row, onClose }: { row: CteMonitorRow; onClose: () => void }) {
  const { promptAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const { data: events = [] } = useCteSefazEvents(row.id);
  const cancelCte = useCancelCTe();

  const handleCancel = async () => {
    const motive = await promptAction('O cancelamento será enviado ao provedor fiscal.', {
      title: 'Cancelar CT-e',
      label: 'Justificativa',
      minLength: 15,
    });
    if (!motive) return;
    try {
      await cancelCte.mutateAsync({ fiscalDocumentId: row.id, justificativa: motive });
      toast.success('Cancelamento solicitado com sucesso');
    } catch {
      // toast já disparado pelo hook
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          CT-e {row.cte_number ?? '—'} <StatusPill status={row.sefaz_status} />
        </DialogTitle>
        <DialogDescription>
          Chave: <span className="font-mono">{row.access_key ?? '—'}</span>
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-center gap-3 mb-4">
        {(row.sefaz_status === 'processed' || row.sefaz_status === 'processed_error') && (
          <Button size="sm" variant="outline" onClick={handleCancel} disabled={cancelCte.isPending}>
            <Ban className="h-4 w-4 mr-2" /> Cancelar CT-e
          </Button>
        )}
        {row.sefaz_status === 'cancelled' && (
          <Badge variant="outline" className="text-destructive border-destructive/30">Documento Cancelado</Badge>
        )}
        {row.sefaz_status === 'processing' && (
          <Badge variant="outline" className="text-amber-600 border-amber-500/30">Em processamento no Hub...</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm border-b pb-4 mb-4">
        <div><span className="text-muted-foreground">Emissão:</span> {row.issued_at ? new Date(row.issued_at).toLocaleString('pt-BR') : '—'}</div>
        <div><span className="text-muted-foreground">Protocolo:</span> {row.protocol_number ?? '—'}</div>
        <div><span className="text-muted-foreground">Remetente:</span> {row.remitter ?? '—'}</div>
        <div><span className="text-muted-foreground">Pagador:</span> {row.payer_name ?? '—'}</div>
        <div><span className="text-muted-foreground">Destinatário:</span> {row.recipient ?? '—'}</div>
        <div><span className="text-muted-foreground">Cidade/UF Destino:</span> {row.recipient_city ?? '—'} / {row.recipient_state ?? '—'}</div>
        <div><span className="text-muted-foreground">Protocolo:</span> {row.protocol_number ?? '—'}</div>
        <div><span className="text-muted-foreground">Ambiente:</span> {row.sefaz_environment ?? '—'}</div>
        <div><span className="text-muted-foreground">Placa:</span> {row.vehicle_plate ?? '—'}</div>
        <div><span className="text-muted-foreground">Motorista:</span> {row.driver_name ?? '—'}</div>
        <div><span className="text-muted-foreground">Frete:</span> R$ {Number(row.freight_value).toFixed(2)}</div>
        <div><span className="text-muted-foreground">Carga:</span> R$ {Number(row.cargo_value).toFixed(2)}</div>
      </div>

      {row.sefaz_status_reason && (
        <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive flex items-center gap-1"><AlertCircle className="h-4 w-4" /> Motivo do erro</p>
          <p className="mt-1">{row.sefaz_status_reason}</p>
          {row.sefaz_status_code && <p className="text-xs mt-1 text-muted-foreground">Código: {row.sefaz_status_code}</p>}
        </div>
      )}

      <div>
        <h3 className="font-medium text-sm mb-2">Histórico de eventos SEFAZ</h3>
        <div className="border rounded max-h-64 overflow-y-auto divide-y">
          {events.length === 0 && (
            <p className="text-xs text-muted-foreground p-3">Nenhum evento registrado ainda. A integração fiscal envia os eventos via webhook.</p>
          )}
          {events.map((e) => (
            <div key={e.id} className="p-2 text-xs">
              <div className="flex justify-between">
                <span className="font-medium">{e.event_type}</span>
                <span className="text-muted-foreground">{new Date(e.occurred_at).toLocaleString('pt-BR')}</span>
              </div>
              {e.reason && <div className="text-muted-foreground">{e.reason}</div>}
              {e.protocol_number && <div className="text-muted-foreground">Protocolo: {e.protocol_number}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end items-center gap-2">
        {row.sefaz_status === 'processed' && row.source === 'hub' && (
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={handleCancel}
            disabled={cancelCte.isPending}
          >
            {cancelCte.isPending ? 'Cancelando...' : 'Cancelar CT-e'}
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => downloadHubFile(toast, row, 'pdf', { view: true })}>
          <Eye className="h-4 w-4" /> Visualizar
        </Button>
        <Button variant="outline" size="sm" onClick={() => downloadHubFile(toast, row, 'pdf')}>
          <FileText className="h-4 w-4" /> PDF
        </Button>
        <Button variant="outline" size="sm" onClick={() => downloadHubFile(toast, row, 'xml')}>
          <FileDown className="h-4 w-4" /> XML
        </Button>
        <Button size="sm" onClick={onClose}>Fechar</Button>
      </div>
    </>
  );
}
