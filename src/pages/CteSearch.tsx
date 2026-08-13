import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
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
import { useCancelCTe } from '@/hooks/useIssueCTe';
import { useDeleteFailedCTe } from '@/hooks/useDeleteFailedCTe';

const TONE_CLASS: Record<string, string> = {
  default: 'bg-secondary text-secondary-foreground',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  danger: 'bg-destructive/15 text-destructive border border-destructive/30',
  muted: 'bg-muted text-muted-foreground',
};

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function StatusPill({ status }: { status: string }) {
  const tone = SEFAZ_STATUS_TONE[status as SefazStatus] ?? 'default';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {SEFAZ_STATUS_LABELS[status as SefazStatus] ?? status}
    </span>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function TriRadio({ label, value, onChange }: { label: string; value: TriState; onChange: (v: TriState) => void }) {
  const opts: { v: TriState; l: string }[] = [
    { v: 'all', l: 'Todos' }, { v: 'yes', l: 'Sim' }, { v: 'no', l: 'Não' },
  ];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex gap-2">
        {opts.map((o) => (
          <label key={o.v} className="flex items-center gap-1 text-xs cursor-pointer">
            <input type="radio" checked={value === o.v} onChange={() => onChange(o.v)} />
            {o.l}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Status usados no dia a dia — os demais ficam nos filtros avançados via busca. */
const QUICK_STATUSES: SefazStatus[] = ['processed', 'pending', 'sent_error', 'processed_error', 'cancelled'];

const ALL_CTE_TYPES: CteType[] = ['normal', 'complementary', 'voiding', 'substitute'];

const DEFAULT_FILTERS: CteSearchFilters = {
  cteTypes: ['normal', 'complementary', 'voiding', 'substitute'],
  statuses: [],
  downloadable: 'all',
  voided: 'no',
  closed: 'all',
  compensated: 'all',
  autonomousFreight: 'all',
  complementaryDoc: 'all',
};

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
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

function toCsv(rows: CteSearchRow[]) {
  const head = [
    'Status', 'Tipo', 'CT-e', 'Serie', 'Chave', 'Emissao', 'Pagador', 'Remetente',
    'Destinatario', 'Cidade', 'UF', 'Placa', 'Motorista', 'Notas', 'Frete', 'Carga',
  ];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [
    SEFAZ_STATUS_LABELS[r.sefaz_status as SefazStatus] ?? r.sefaz_status,
    CTE_TYPE_LABELS[r.cte_type as CteType] ?? r.cte_type,
    r.cte_number, r.cte_series, r.access_key,
    r.issued_at ? new Date(r.issued_at).toLocaleDateString('pt-BR') : '',
    r.payer_name, r.remitter, r.recipient, r.recipient_city, r.recipient_state,
    r.vehicle_plate, r.driver_name, r.invoice_numbers,
    r.freight_value.toFixed(2).replace('.', ','), r.cargo_value.toFixed(2).replace('.', ','),
  ].map(esc).join(';'));
  return '\uFEFF' + [head.join(';'), ...lines].join('\n');
}

export default function CteSearch() {
  const cancelCte = useCancelCTe();
  const deleteCte = useDeleteFailedCTe();
  const [draft, setDraft] = useState<CteSearchFilters>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<CteSearchFilters>(DEFAULT_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const { data: rows = [], isLoading, isFetching, refetch } = useCteSearch(filters);

  function apply(next?: Partial<CteSearchFilters>) {
    const merged = { ...draft, ...(next ?? {}) };
    setDraft(merged);
    setFilters(merged);
    setChecked(new Set());
  }
  function clear() {
    setDraft(DEFAULT_FILTERS);
    setFilters(DEFAULT_FILTERS);
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
    apply({
      issueDateStart: days === null ? '' : isoDaysAgo(days),
      issueDateEnd: '',
    });
  }

  const downloadableRows = useMemo(() => rows.filter(canDownloadCte), [rows]);
  const checkedRows = useMemo(() => rows.filter((r) => checked.has(r.id)), [rows, checked]);

  const cities = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const c = (r.recipient_city || '').trim();
      if (!c) continue;
      map.set(c, (map.get(c) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [rows]);

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
    } catch (e: any) {
      toast.error('Falha no download em massa', { id: toastId, description: e?.message, duration: 12_000 });
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
    } catch (e: any) {
      toast.error(`Falha ao obter ${format.toUpperCase()}`, { id: toastId, description: e?.message });
    }
  }

  function exportCsv() {
    if (rows.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);
    saveBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `consulta-ctes-${stamp}.csv`);
    toast.success(`CSV com ${rows.length} registro(s) gerado`);
  }

  async function handleCancel(row: CteSearchRow) {
    const motive = window.prompt('Justificativa para o cancelamento (mínimo 15 caracteres):');
    if (!motive) return;
    try {
      await cancelCte.mutateAsync({ fiscalDocumentId: row.id, justificativa: motive });
      toast.success('Cancelamento solicitado com sucesso');
    } catch (e) {
      // toast já disparado pelo hook
    }
  async function handleDelete(row: CteSearchRow) {
    if (!window.confirm('Deseja excluir este registro de erro? Esta ação é irreversível e serve apenas para limpar tentativas que falharam.')) return;
    await deleteCte.mutateAsync(row.id);
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
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
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
            <Input type="date" value={draft.issueDateStart ?? ''} onChange={(e) => apply({ issueDateStart: e.target.value })} />
          </Field>
          <Field label="Emissão — Fim" className="w-[150px]">
            <Input type="date" value={draft.issueDateEnd ?? ''} onChange={(e) => apply({ issueDateEnd: e.target.value })} />
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

      {/* Totais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><p className="text-xs text-muted-foreground">CT-e encontrados</p><p className="text-2xl font-semibold">{totals.count}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Autorizados / com arquivo</p><p className="text-2xl font-semibold">{totals.authorized} / {totals.downloadable}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Total Frete</p><p className="text-2xl font-semibold">{BRL(totals.freight)}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Total Carga</p><p className="text-2xl font-semibold">{BRL(totals.cargo)}</p></Card>
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
              {checked.size === downloadableRows.length ? 'Limpar seleção' : `Selecionar todos com arquivo (${downloadableRows.length})`}
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
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 w-8">
                  <Checkbox
                    checked={downloadableRows.length > 0 && checked.size === downloadableRows.length}
                    onCheckedChange={toggleAll}
                    aria-label="Selecionar todos"
                  />
                </th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Nº CT-e</th>
                <th className="text-left px-3 py-2">Sér.</th>
                <th className="text-left px-3 py-2">Emissão</th>
                <th className="text-left px-3 py-2">Remetente</th>
                <th className="text-left px-3 py-2">Destinatário</th>
                <th className="text-left px-3 py-2">Cidade / UF</th>
                <th className="text-left px-3 py-2">Placa</th>
                <th className="text-right px-3 py-2">Frete</th>
                <th className="text-right px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={12} className="text-center text-muted-foreground py-8">Carregando…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={12} className="text-center text-muted-foreground py-8">
                  Nenhum CT-e encontrado com os filtros atuais.
                </td></tr>
              )}
              {rows.map((r) => {
                const has = canDownloadCte(r);
                return (
                  <tr key={r.id} className={`border-t hover:bg-muted/30 ${checked.has(r.id) ? 'bg-primary/5' : ''}`}>
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={checked.has(r.id)}
                        onCheckedChange={() => toggleRow(r.id)}
                        disabled={!has}
                        aria-label={`Selecionar ${cteLabel(r)}`}
                      />
                    </td>
                    <td className="px-3 py-2"><StatusPill status={r.sefaz_status} /></td>
                    <td className="px-3 py-2 text-xs">{CTE_TYPE_LABELS[r.cte_type as CteType] ?? r.cte_type}</td>
                    <td className="px-3 py-2 font-mono">{r.cte_number ?? '—'}</td>
                    <td className="px-3 py-2">{r.cte_series ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{r.issued_at ? new Date(r.issued_at).toLocaleDateString('pt-BR') : '—'}</td>
                    <td className="px-3 py-2">{r.remitter ?? '—'}</td>
                    <td className="px-3 py-2">{r.recipient ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{[r.recipient_city, r.recipient_state].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-2 font-mono">{r.vehicle_plate ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{BRL(r.freight_value)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" title="Visualizar DACTE" disabled={!has} onClick={() => oneFile(r, 'pdf', true)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Baixar PDF" disabled={!has} onClick={() => oneFile(r, 'pdf')}>
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Baixar XML" disabled={!has} onClick={() => oneFile(r, 'xml')}>
                          <FileDown className="h-4 w-4" />
                        </Button>
                        {(r.sefaz_status === 'processed' || r.sefaz_status === 'processed_error' || r.sefaz_status === 'authorized') && r.source === 'hub' && (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="text-destructive hover:text-destructive hover:bg-destructive/10" 
                            title="Cancelar CT-e" 
                            disabled={cancelCte.isPending} 
                            onClick={() => handleCancel(r)}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                        {(r.sefaz_status === 'error' || r.sefaz_status === 'rejected') && !r.hub_document_id && (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="text-destructive hover:text-destructive hover:bg-destructive/10" 
                            title="Excluir registro de erro" 
                            disabled={deleteCte.isPending} 
                            onClick={() => handleDelete(r)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
