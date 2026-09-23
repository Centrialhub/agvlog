import { useScopedAlerts } from '@/hooks/useAlertStore';
import { useMemo, useState, useEffect, useRef, useId } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterField as Field } from '@/components/ui/filter-field';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { PendingInvoicesBanner } from '@/components/billing/PendingInvoicesBanner';
import {
  useCteSearch, CTE_TYPE_LABELS,
  type CteSearchFilters, type CteSearchRow, type CteType, type TriState,
} from '@/hooks/useCteSearch';
import { SEFAZ_STATUS_LABELS, SEFAZ_STATUS_TONE, type SefazStatus } from '@/hooks/useCteMonitor';
import { runBulkDownload, summarizeBulkResult } from '@/lib/fiscal/bulkFileMerge';
import { fetchCteBlob, cteFileName, cteLabel, canDownloadCte, saveBlob, openBlob } from '@/lib/fiscal/cteFiles';
import {
  Search, X, Filter as FilterIcon, FileText, FileDown, Eye, RefreshCw,
  ChevronDown, ChevronUp, Download, Table as TableIcon, Trash2, Ban,
} from 'lucide-react';
import { useCancelCTe, useResendCte } from '@/hooks/useIssueCTe';
import { useDeleteFailedCTe } from '@/hooks/useDeleteFailedCTe';
import { usePollCteStatus } from '@/hooks/usePollCteStatus';
import { useSortableData } from '@/hooks/useSortableData';
import { APP_TIME_ZONE, fmtDateInTimeZone, localDateInputValue, shiftDateInputValue } from '@/lib/utils/formatDate';
import { useTenant } from '@/hooks/useTenant';
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { csvSafeCell } from '@/lib/csvSafety';

const TONE_CLASS: Record<string, string> = {
  default: 'bg-secondary text-secondary-foreground',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  danger: 'bg-destructive/15 text-destructive border border-destructive/30',
  muted: 'bg-muted text-muted-foreground',
};

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Falha inesperada';

function StatusPill({ status }: { status: string }) {
  const tone = SEFAZ_STATUS_TONE[status as SefazStatus] ?? 'default';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {SEFAZ_STATUS_LABELS[status as SefazStatus] ?? status}
    </span>
  );
}

function TriRadio({ label, value, onChange }: { label: string; value: TriState; onChange: (v: TriState) => void }) {
  const name = useId();
  const opts: { v: TriState; l: string }[] = [
    { v: 'all', l: 'Todos' }, { v: 'yes', l: 'Sim' }, { v: 'no', l: 'Não' },
  ];
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs text-muted-foreground">{label}</legend>
      <div className="flex gap-2">
        {opts.map((o) => (
          <label key={o.v} className="flex items-center gap-1 text-xs cursor-pointer">
            <input type="radio" name={name} checked={value === o.v} onChange={() => onChange(o.v)} />
            {o.l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Status usados no dia a dia — os demais ficam nos filtros avançados via busca. */
const QUICK_STATUSES: SefazStatus[] = ['processed', 'pending', 'sent_error', 'processed_error', 'sefaz_error', 'cancelled'];

const ALL_CTE_TYPES: CteType[] = ['normal', 'complementary', 'voiding', 'substitute'];

const DEFAULT_FILTERS: CteSearchFilters = {
  cteTypes: ['normal', 'complementary', 'voiding', 'substitute'],
  statuses: [],
  downloadable: 'all',
  voided: 'all',
  closed: 'all',
  compensated: 'all',
  autonomousFreight: 'all',
  complementaryDoc: 'all',
};

// eslint-disable-next-line react-refresh/only-export-components
export function cteSearchPeriod(today: string, days: number): { issueDateStart: string; issueDateEnd: string } {
  const inclusiveDays = days === 0 ? 1 : days;
  return {
    issueDateStart: shiftDateInputValue(today, -(inclusiveDays - 1)),
    issueDateEnd: today,
  };
}

function activeFilterCount(f: CteSearchFilters) {
  let n = 0;
  const skip = new Set(['cteTypes', 'statuses', 'downloadable', 'voided', 'closed', 'compensated', 'autonomousFreight', 'complementaryDoc']);
  for (const [k, v] of Object.entries(f)) {
    if (skip.has(k)) continue;
    if (typeof v === 'string' && v.trim()) n++;
  }
  if ((f.statuses?.length ?? 0) > 0) n++;
  if ((f.cteTypes?.length ?? 4) < 4) n++;
  if (f.downloadable && f.downloadable !== 'all') n++;
  for (const k of ['voided', 'closed', 'compensated', 'autonomousFreight', 'complementaryDoc'] as const) {
    if (f[k] && f[k] !== (DEFAULT_FILTERS[k] ?? 'all')) n++;
  }
  return n;
}

// eslint-disable-next-line react-refresh/only-export-components
export function validateCteSearchDates(filters: CteSearchFilters): string | null {
  return filters.issueDateStart && filters.issueDateEnd && filters.issueDateStart > filters.issueDateEnd
    ? 'A emissão inicial não pode ser posterior à emissão final.' : null;
}

// eslint-disable-next-line react-refresh/only-export-components
export function isCteCancellationAllowed(row: Pick<CteSearchRow, 'sefaz_status' | 'hub_document_id' | 'source'>) {
  return ['processed', 'processed_error', 'authorized'].includes(row.sefaz_status)
    && Boolean(row.hub_document_id) && row.source === 'hub';
}

// eslint-disable-next-line react-refresh/only-export-components
export function isExactCteSelection(checked: Set<string>, ids: string[]) {
  return ids.length > 0 && checked.size === ids.length && ids.every(id => checked.has(id));
}

// eslint-disable-next-line react-refresh/only-export-components
export function reconcileCteSelection(checked: Set<string>, ids: string[]) {
  const currentIds = new Set(ids);
  return new Set([...checked].filter(id => currentIds.has(id)));
}

// eslint-disable-next-line react-refresh/only-export-components
export function toCsv(rows: CteSearchRow[], timeZone = APP_TIME_ZONE) {
  const head = [
    'Status', 'Tipo', 'CT-e', 'Serie', 'Chave', 'Emissao', 'Pagador', 'Remetente',
    'Destinatario', 'Cidade', 'UF', 'Placa', 'Motorista', 'Notas', 'Frete', 'Carga',
  ];
  const esc = (value: unknown) => {
    const safe = csvSafeCell(value);
    return safe.startsWith('"') && safe.endsWith('"') ? safe : `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((r) => [
    SEFAZ_STATUS_LABELS[r.sefaz_status as SefazStatus] ?? r.sefaz_status,
    CTE_TYPE_LABELS[r.cte_type as CteType] ?? r.cte_type,
    r.cte_number, r.cte_series, r.access_key,
    fmtDateInTimeZone(r.issued_at, timeZone, ''),
    r.payer_name, r.remitter, r.recipient, r.recipient_city, r.recipient_state,
    r.vehicle_plate, r.driver_name, r.invoice_numbers,
    r.freight_value.toFixed(2).replace('.', ','), r.cargo_value.toFixed(2).replace('.', ','),
  ].map(esc).join(';'));
  return '\uFEFF' + [head.join(';'), ...lines].join('\n');
}

export default function CteSearch() {
  const { currentTenant } = useTenant();
  const tenantTimezone = currentTenant?.timezone || APP_TIME_ZONE;
  const { promptAction, confirmAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const cancelCte = useCancelCTe();
  const resendCte = useResendCte();
  const deleteCte = useDeleteFailedCTe();
  const pollStatus = usePollCteStatus();
  const [draft, setDraft] = useState<CteSearchFilters>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<CteSearchFilters>(DEFAULT_FILTERS);
  const [filterError, setFilterError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [cities, setCities] = useState<Array<[string, number]>>([]);
  const { data: rowsData = [], isLoading, isFetching, error: searchError, refetch } = useCteSearch(filters);
  const resultsReady = !isFetching && !searchError;
  const { sortedItems: rows, requestSort, sortConfig } = useSortableData(resultsReady ? rowsData : []);
  useEffect(() => {
    if (!resultsReady || filters.recipientCity) return;
    const counts = new Map<string, number>();
    for (const row of rowsData) {
      const city = (row.recipient_city || '').trim();
      if (city) counts.set(city, (counts.get(city) || 0) + 1);
    }
    const next = [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0], 'pt-BR')) as Array<[string, number]>;
    setCities(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, [filters.recipientCity, resultsReady, rowsData]);

  // Polling automático para documentos em cancelamento ou transmissão
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const transientRows = rows.filter(r => 
      r.hub_document_id && 
      (r.sefaz_status === 'cancel_pending' || r.sefaz_status === 'cancelling' || r.sefaz_status === 'processing')
    );

    if (transientRows.length > 0) {
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(() => {
          transientRows.forEach(row => {
            if (row.hub_document_id) {
              pollStatus.mutate({ 
                hubDocumentId: row.hub_document_id, 
                emissionId: row.emission_id || undefined,
                fiscalDocumentId: row.id 
              });
            }
          });
        }, 5000); // Polling a cada 5 segundos
      }
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [rows, pollStatus]);

  function apply(next?: Partial<CteSearchFilters>) {
    const merged = { ...draft, ...(next ?? {}) };
    setDraft(merged);
    const validationError = validateCteSearchDates(merged);
    setFilterError(validationError || '');
    if (validationError) return;
    setFilters(merged);
    setChecked(new Set());
  }
  function clear() {
    setDraft(DEFAULT_FILTERS);
    setFilters(DEFAULT_FILTERS);
    setFilterError('');
    setChecked(new Set());
  }

  function toggleType(t: CteType) {
    const cur = new Set(draft.cteTypes ?? []);
    if (cur.has(t)) cur.delete(t); else cur.add(t);
    setDraft({ ...draft, cteTypes: Array.from(cur) });
  }

  function toggleStatus(s: SefazStatus) {
    const cur = new Set(filters.statuses ?? []);
    if (cur.has(s)) cur.delete(s); else cur.add(s);
    apply({ statuses: Array.from(cur) });
  }

  function setPeriod(days: number | null) {
    if (days === null) apply({ issueDateStart: '', issueDateEnd: '' });
    else apply(cteSearchPeriod(localDateInputValue(new Date(), tenantTimezone), days));
  }

  const downloadableRows = useMemo(() => rows.filter(canDownloadCte), [rows]);
  const checkedRows = useMemo(() => rows.filter((r) => checked.has(r.id)), [rows, checked]);
  const downloadableIds = useMemo(() => downloadableRows.map(row => row.id).sort(), [downloadableRows]);
  const downloadableIdsKey = downloadableIds.join('|');
  const allDownloadableSelected = isExactCteSelection(checked, downloadableIds);
  useEffect(() => {
    setChecked(previous => {
      const reconciled = reconcileCteSelection(previous, downloadableIdsKey ? downloadableIdsKey.split('|') : []);
      if (reconciled.size === previous.size && [...reconciled].every(id => previous.has(id))) return previous;
      return reconciled;
    });
  }, [downloadableIdsKey]);

  const totals = useMemo(() => {
    let freight = 0, cargo = 0, authorized = 0, downloadable = 0;
    for (const r of rows) {
      freight += r.freight_value;
      cargo += r.cargo_value;
      if (r.sefaz_status === 'processed') authorized++;
      if (canDownloadCte(r)) downloadable++;
    }
    return { count: rows.length, freight, cargo, authorized, downloadable };
  }, [rows]);

  const selectedTotals = useMemo(() => {
    let freight = 0;
    for (const r of checkedRows) freight += r.freight_value;
    return { freight };
  }, [checkedRows]);

  function toggleRow(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setChecked(allDownloadableSelected ? new Set() : new Set(downloadableRows.map((r) => r.id)));
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
        outputBase: `consulta-ctes-${format}-${stamp}`,
        fetchOne: (row) => fetchCteBlob(row, format),
        labelOf: cteLabel,
        filenameOf: (row) => cteFileName(row, format),
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
      toast.error('Falha no download em massa', { id: toastId, description: errorMessage(error), duration: 12_000 });
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  async function oneFile(row: CteSearchRow, format: 'pdf' | 'xml', view = false) {
    const filename = cteFileName(row, format);
    const toastId = toast.loading(`${view ? 'Abrindo' : 'Baixando'} ${format.toUpperCase()}...`);
    try {
      const blob = await fetchCteBlob(row, format);
      if (view) openBlob(blob, filename); else saveBlob(blob, filename);
      toast.success(`${format.toUpperCase()} ${view ? 'aberto' : 'baixado'}`, { id: toastId });
    } catch (error: unknown) {
      toast.error(`Falha ao obter ${format.toUpperCase()}`, { id: toastId, description: errorMessage(error) });
    }
  }

  function exportCsv() {
    if (rows.length === 0) return;
    const stamp = localDateInputValue(new Date(), tenantTimezone);
    saveBlob(new Blob([toCsv(rows, tenantTimezone)], { type: 'text/csv;charset=utf-8' }), `consulta-ctes-${stamp}.csv`);
    toast.success(`CSV com ${rows.length} registro(s) gerado`);
  }

  async function handleCancel(row: CteSearchRow) {
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
  }

  async function handleDelete(row: CteSearchRow) {
    if (!await confirmAction(
      'Deseja excluir este registro de erro? Esta ação é irreversível e serve apenas para limpar tentativas que falharam.',
      { title: 'Excluir registro de erro', confirmLabel: 'Excluir' },
    )) return;
    await deleteCte.mutateAsync(row.id);
  }

  async function handleResend(row: CteSearchRow) {
    try {
      await resendCte.mutateAsync(row.id);
      toast.success('Operação fiscal consultada e recuperada');
    } catch (error: unknown) {
      toast.error('Falha ao reenviar', { description: errorMessage(error) });
    }
  }

  const activeCount = activeFilterCount(filters);

  return (
    <div className="flex flex-col gap-4 p-4">
      <PendingInvoicesBanner from="search" />

      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Consulta CT-e</h1>
          <p className="text-sm text-muted-foreground">
            Busca nos CT-e emitidos (rascunhos e transmitidos) com download em lote de DACTE e XML.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{totals.count} registro(s)</Badge>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!resultsReady || rows.length === 0}>
            <TableIcon className="h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>
      </header>

      {/* Busca rápida */}
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]">
            <Field label="Busca rápida (nº, chave, cliente, cidade, placa, NF)">
              <div className="flex gap-2">
                <Input
                  value={draft.text ?? ''}
                  placeholder="Ex.: 1234, Santiago, JANAUBA, ABC1D23"
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
                />
                <Button size="sm" onClick={() => apply()}><Search className="h-4 w-4" /> Buscar</Button>
              </div>
            </Field>
          </div>
          <Field label="Emissão — Início" className="w-[150px]">
            <Input type="date" max={draft.issueDateEnd || undefined} value={draft.issueDateStart ?? ''} onChange={(e) => apply({ issueDateStart: e.target.value })} />
          </Field>
          <Field label="Emissão — Fim" className="w-[150px]">
            <Input type="date" min={draft.issueDateStart || undefined} value={draft.issueDateEnd ?? ''} onChange={(e) => apply({ issueDateEnd: e.target.value })} />
          </Field>
          <Field label="Cidade destino" className="w-[200px]">
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={filters.recipientCity ?? ''}
              onChange={(e) => apply({ recipientCity: e.target.value })}
            >
              <option value="">Todas as cidades</option>
              {cities.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
            </select>
          </Field>
        </div>

        {filterError ? <p role="alert" className="text-sm text-destructive">{filterError}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Período</span>
          {[{ l: 'Hoje', d: 0 }, { l: '7 dias', d: 7 }, { l: '30 dias', d: 30 }, { l: '90 dias', d: 90 }].map((p) => (
            <Button key={p.l} size="sm" variant="outline" onClick={() => setPeriod(p.d)}>{p.l}</Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setPeriod(null)}>Tudo</Button>

          <span className="ml-2 text-[11px] uppercase tracking-wide text-muted-foreground">Status</span>
          {QUICK_STATUSES.map((s) => {
            const on = (filters.statuses ?? []).includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground'}`}
              >
                {SEFAZ_STATUS_LABELS[s] ?? s}
              </button>
            );
          })}

          <button
            onClick={() => apply({ downloadable: filters.downloadable === 'yes' ? 'all' : 'yes' })}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${filters.downloadable === 'yes' ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground'}`}
          >
            Só com arquivo
          </button>

          <div className="ml-auto flex items-center gap-2">
            {activeCount > 0 && <Badge variant="secondary">{activeCount} filtro(s) ativo(s)</Badge>}
            <Button size="sm" variant="ghost" onClick={() => setShowAdvanced((v) => !v)}>
              <FilterIcon className="h-4 w-4" /> Filtros avançados
              {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="outline" onClick={clear}><X className="h-4 w-4" /> Limpar</Button>
          </div>
        </div>

        {showAdvanced && (
          <div className="border-t pt-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <Field label="Nº Doc"><Input value={draft.docNumber ?? ''} onChange={(e) => setDraft({ ...draft, docNumber: e.target.value })} /></Field>
              <Field label="Chave de acesso"><Input value={draft.accessKey ?? ''} onChange={(e) => setDraft({ ...draft, accessKey: e.target.value })} /></Field>
              <Field label="Nº Interno"><Input value={draft.internalNumber ?? ''} onChange={(e) => setDraft({ ...draft, internalNumber: e.target.value })} /></Field>
              <Field label="Nº Ref."><Input value={draft.referenceNumber ?? ''} onChange={(e) => setDraft({ ...draft, referenceNumber: e.target.value })} /></Field>
              <Field label="Série"><Input value={draft.series ?? ''} onChange={(e) => setDraft({ ...draft, series: e.target.value })} /></Field>
              <Field label="Nota Fiscal"><Input value={draft.invoiceNumber ?? ''} onChange={(e) => setDraft({ ...draft, invoiceNumber: e.target.value })} /></Field>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Remetente"><Input value={draft.remitter ?? ''} onChange={(e) => setDraft({ ...draft, remitter: e.target.value })} /></Field>
              <Field label="Cliente/Destinatário"><Input value={draft.recipient ?? ''} onChange={(e) => setDraft({ ...draft, recipient: e.target.value })} /></Field>
              <Field label="Município"><Input value={draft.recipientCity ?? ''} onChange={(e) => setDraft({ ...draft, recipientCity: e.target.value })} /></Field>
              <Field label="Fornecedor/Pagador"><Input value={draft.payer ?? ''} onChange={(e) => setDraft({ ...draft, payer: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Field label="Consignatário"><Input value={draft.consignee ?? ''} onChange={(e) => setDraft({ ...draft, consignee: e.target.value })} /></Field>
              <Field label="Grp Pagador"><Input value={draft.payerGroup ?? ''} onChange={(e) => setDraft({ ...draft, payerGroup: e.target.value })} /></Field>
              <Field label="Seguradora"><Input value={draft.insuranceCompany ?? ''} onChange={(e) => setDraft({ ...draft, insuranceCompany: e.target.value })} /></Field>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <Field label="Motorista"><Input value={draft.driverName ?? ''} onChange={(e) => setDraft({ ...draft, driverName: e.target.value })} /></Field>
              <Field label="Placa"><Input value={draft.vehiclePlate ?? ''} onChange={(e) => setDraft({ ...draft, vehiclePlate: e.target.value })} /></Field>
              <Field label="Placa Carreta"><Input value={draft.trailerPlate ?? ''} onChange={(e) => setDraft({ ...draft, trailerPlate: e.target.value })} /></Field>
              <Field label="Nº Contrato"><Input value={draft.contractNumber ?? ''} onChange={(e) => setDraft({ ...draft, contractNumber: e.target.value })} /></Field>
              <Field label="Nº Viagem"><Input value={draft.tripNumber ?? ''} onChange={(e) => setDraft({ ...draft, tripNumber: e.target.value })} /></Field>
              <Field label="Romexp"><Input value={draft.romexpNumber ?? ''} onChange={(e) => setDraft({ ...draft, romexpNumber: e.target.value })} /></Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Tipo CT-e</p>
                <div className="flex flex-wrap gap-3">
                  {ALL_CTE_TYPES.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={(draft.cteTypes ?? []).includes(t)} onCheckedChange={() => toggleType(t)} />
                      {CTE_TYPE_LABELS[t]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <TriRadio label="Anulado" value={draft.voided ?? 'all'} onChange={(v) => setDraft({ ...draft, voided: v })} />
                <TriRadio label="Encerrado" value={draft.closed ?? 'all'} onChange={(v) => setDraft({ ...draft, closed: v })} />
                <TriRadio label="Compensado" value={draft.compensated ?? 'all'} onChange={(v) => setDraft({ ...draft, compensated: v })} />
                <TriRadio label="Frete Autônomo" value={draft.autonomousFreight ?? 'all'} onChange={(v) => setDraft({ ...draft, autonomousFreight: v })} />
                <TriRadio label="Doc. Complementar" value={draft.complementaryDoc ?? 'all'} onChange={(v) => setDraft({ ...draft, complementaryDoc: v })} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => apply()} size="sm"><Search className="h-4 w-4" /> Aplicar filtros</Button>
              <Button onClick={clear} variant="outline" size="sm"><X className="h-4 w-4" /> Limpar</Button>
            </div>
          </div>
        )}
      </Card>

      {searchError && <Card role="alert" className="p-3 text-destructive flex items-center justify-between gap-2">
        <span>Não foi possível consultar os CT-e: {errorMessage(searchError)}.</span>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>Tentar novamente</Button>
      </Card>}
      {isFetching && !isLoading ? <Card role="status" className="p-3 text-muted-foreground">Atualizando a consulta; resultados e ações permanecerão indisponíveis até a confirmação.</Card> : null}

      {/* Totais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><p className="text-xs text-muted-foreground">CT-e encontrados</p><p className="text-2xl font-semibold">{resultsReady ? totals.count : '—'}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Autorizados / com arquivo</p><p className="text-2xl font-semibold">{resultsReady ? `${totals.authorized} / ${totals.downloadable}` : '—'}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Total Frete</p><p className="text-2xl font-semibold">{resultsReady ? BRL(totals.freight) : '—'}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Total Carga</p><p className="text-2xl font-semibold">{resultsReady ? BRL(totals.cargo) : '—'}</p></Card>
      </div>

      {/* Barra de download em lote */}
      {(checkedRows.length > 0 || bulkBusy) && (
        <Card className="p-3 flex flex-wrap items-center gap-3 border-primary/40">
          <span className="text-sm font-medium">
            {checkedRows.length} selecionado(s) — frete {BRL(selectedTotals.freight)}
          </span>
          <span className="text-xs text-muted-foreground">
            {bulkProgress
              ? `Baixando ${bulkProgress.done}/${bulkProgress.total} do Hub Fiscal...`
              : 'O PDF sai em arquivo único (uma nota por página); XML sai em ZIP.'}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={toggleAll} disabled={bulkBusy}>
              {allDownloadableSelected ? 'Limpar seleção' : `Selecionar todos com arquivo (${downloadableRows.length})`}
            </Button>
            <Button size="sm" onClick={() => bulkDownload('pdf')} disabled={bulkBusy}>
              <Download className="h-4 w-4" /> Baixar PDF único
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkDownload('xml')} disabled={bulkBusy}>
              <FileDown className="h-4 w-4" /> Baixar XMLs (ZIP)
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50 text-xs uppercase">
              <TableRow>
                <TableHead className="px-3 py-2 w-8">
                  <Checkbox
                    checked={allDownloadableSelected}
                    onCheckedChange={toggleAll}
                    disabled={!resultsReady || downloadableRows.length === 0}
                    aria-label="Selecionar todos"
                  />
                </TableHead>
                <TableHead sortKey="sefaz_status" sortConfig={sortConfig} onSort={requestSort}>Status</TableHead>
                <TableHead sortKey="cte_type" sortConfig={sortConfig} onSort={requestSort}>Tipo</TableHead>
                <TableHead sortKey="cte_number" sortConfig={sortConfig} onSort={requestSort}>Nº CT-e</TableHead>
                <TableHead sortKey="cte_series" sortConfig={sortConfig} onSort={requestSort}>Sér.</TableHead>
                <TableHead sortKey="issued_at" sortConfig={sortConfig} onSort={requestSort}>Emissão</TableHead>
                <TableHead sortKey="remitter" sortConfig={sortConfig} onSort={requestSort}>Remetente</TableHead>
                <TableHead sortKey="recipient" sortConfig={sortConfig} onSort={requestSort}>Destinatário</TableHead>
                <TableHead sortKey="recipient_city" sortConfig={sortConfig} onSort={requestSort}>Cidade / UF</TableHead>
                <TableHead sortKey="vehicle_plate" sortConfig={sortConfig} onSort={requestSort}>Placa</TableHead>
                <TableHead sortKey="freight_value" sortConfig={sortConfig} onSort={requestSort} className="text-right">Frete</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isFetching && <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">Carregando a consulta atual…</TableCell></TableRow>}
              {!isFetching && !searchError && rows.length === 0 && (
                <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                  Nenhum CT-e encontrado para os filtros informados.

                </TableCell></TableRow>
              )}
              {rows.map((r) => {
                const has = canDownloadCte(r);
                const rowLabel = cteLabel(r);
                return (
                  <TableRow key={r.id} className={`border-t hover:bg-muted/30 ${checked.has(r.id) ? 'bg-primary/5' : ''}`}>
                    <TableCell className="px-3 py-2">
                      <Checkbox
                        checked={checked.has(r.id)}
                        onCheckedChange={() => toggleRow(r.id)}
                        disabled={!resultsReady || !has}
                        aria-label={`Selecionar ${cteLabel(r)}`}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <div className="flex flex-col gap-0.5">
                        <StatusPill status={r.sefaz_status} />
                        {r.sefaz_status_reason && (
                          <span className="text-[10px] text-destructive max-w-[200px] whitespace-normal font-medium mt-1 leading-tight" title={r.sefaz_status_reason}>
                            {r.sefaz_status_reason}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2 text-xs">{CTE_TYPE_LABELS[r.cte_type as CteType] ?? r.cte_type}</TableCell>
                    <TableCell className="px-3 py-2 font-mono">{r.cte_number ?? '—'}</TableCell>
                    <TableCell className="px-3 py-2">{r.cte_series ?? '—'}</TableCell>
                    <TableCell className="px-3 py-2 text-xs">{fmtDateInTimeZone(r.issued_at, tenantTimezone)}</TableCell>
                    <TableCell className="px-3 py-2 text-xs truncate max-w-[150px]" title={r.remitter ?? ''}>{r.remitter ?? '—'}</TableCell>
                    <TableCell className="px-3 py-2 text-xs truncate max-w-[150px]" title={r.recipient ?? ''}>{r.recipient ?? '—'}</TableCell>
                    <TableCell className="px-3 py-2 text-xs">{[r.recipient_city, r.recipient_state].filter(Boolean).join(' / ') || '—'}</TableCell>
                    <TableCell className="px-3 py-2 font-mono text-xs">{r.vehicle_plate ?? '—'}</TableCell>
                    <TableCell className="px-3 py-2 text-right text-xs">{BRL(r.freight_value)}</TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" title="Visualizar DACTE" aria-label={`Visualizar DACTE do ${rowLabel}`} disabled={!resultsReady || !has} onClick={() => oneFile(r, 'pdf', true)}>
                          <Eye aria-hidden="true" className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Baixar PDF" aria-label={`Baixar PDF do ${rowLabel}`} disabled={!resultsReady || !has} onClick={() => oneFile(r, 'pdf')}>
                          <FileText aria-hidden="true" className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Baixar XML" aria-label={`Baixar XML do ${rowLabel}`} disabled={!resultsReady || !has} onClick={() => oneFile(r, 'xml')}>
                          <FileDown aria-hidden="true" className="h-4 w-4" />
                        </Button>
                        {isCteCancellationAllowed(r) && (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="text-destructive hover:text-destructive hover:bg-destructive/10" 
                            title="Cancelar CT-e" 
                            aria-label={`Cancelar ${rowLabel}`}
                            disabled={!resultsReady || cancelCte.isPending} 
                            onClick={() => handleCancel(r)}
                          >
                            <Ban aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        )}
                        {r.sefaz_status.endsWith('_error') && (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            title="Consultar/recuperar operação"
                            aria-label={`Consultar ou recuperar operação do ${rowLabel}`}
                            disabled={!resultsReady || resendCte.isPending}
                            onClick={() => handleResend(r)}
                          >
                            <RefreshCw aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        )}
                        {(r.sefaz_status === 'error' || r.sefaz_status === 'rejected' || r.sefaz_status === 'sent_error' || r.sefaz_status === 'processed_error' || r.sefaz_status === 'sefaz_error') && (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="text-destructive hover:text-destructive hover:bg-destructive/10" 
                            title={r.hub_document_id ? "Remover rascunho (possui ID no Hub)" : "Excluir registro de erro"} 
                            aria-label={r.hub_document_id ? `Remover rascunho do ${rowLabel}` : `Excluir registro de erro do ${rowLabel}`}
                            disabled={!resultsReady || deleteCte.isPending} 
                            onClick={() => handleDelete(r)}
                          >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
