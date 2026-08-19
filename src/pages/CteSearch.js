import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/sonner';
import { PendingInvoicesBanner } from '@/components/billing/PendingInvoicesBanner';
import { useCteSearch, CTE_TYPE_LABELS, } from '@/hooks/useCteSearch';
import { SEFAZ_STATUS_LABELS, SEFAZ_STATUS_TONE } from '@/hooks/useCteMonitor';
import { runBulkDownload, summarizeBulkResult } from '@/lib/fiscal/bulkFileMerge';
import { fetchCteBlob, cteFileName, cteLabel, canDownloadCte, saveBlob, openBlob } from '@/lib/fiscal/cteFiles';
import { Search, X, Filter as FilterIcon, FileText, FileDown, Eye, RefreshCw, ChevronDown, ChevronUp, Download, Table as TableIcon, Trash2, Ban, } from 'lucide-react';
import { useCancelCTe, useResendCte } from '@/hooks/useIssueCTe';
import { useDeleteFailedCTe } from '@/hooks/useDeleteFailedCTe';
import { usePollCteStatus } from '@/hooks/usePollCteStatus';
import { useSortableData } from '@/hooks/useSortableData';
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from '@/components/ui/table';
const TONE_CLASS = {
    default: 'bg-secondary text-secondary-foreground',
    success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
    danger: 'bg-destructive/15 text-destructive border border-destructive/30',
    muted: 'bg-muted text-muted-foreground',
};
const BRL = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function StatusPill({ status }) {
    const tone = SEFAZ_STATUS_TONE[status] ?? 'default';
    return (_jsx("span", { className: `inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`, children: SEFAZ_STATUS_LABELS[status] ?? status }));
}
function Field({ label, children, className = '' }) {
    return (_jsxs("div", { className: `flex flex-col gap-1 ${className}`, children: [
            _jsx("label", { className: "text-[11px] uppercase tracking-wide text-muted-foreground", children: label }), children] }));
}
function TriRadio({ label, value, onChange }) {
    const opts = [
        { v: 'all', l: 'Todos' }, { v: 'yes', l: 'Sim' }, { v: 'no', l: 'Não' },
    ];
    return (_jsxs("div", { className: "flex flex-col gap-1", children: [
            _jsx("span", { className: "text-[11px] uppercase tracking-wide text-muted-foreground", children: label }), _jsx("div", { className: "flex gap-2", children: opts.map((o) => (_jsxs("label", { className: "flex items-center gap-1 text-xs cursor-pointer", children: [
                        _jsx("input", { type: "radio", checked: value === o.v, onChange: () => onChange(o.v) }), o.l] }, o.v))) })
        ] }));
}
/** Status usados no dia a dia — os demais ficam nos filtros avançados via busca. */
const QUICK_STATUSES = ['processed', 'pending', 'sent_error', 'processed_error', 'sefaz_error', 'cancelled'];
const ALL_CTE_TYPES = ['normal', 'complementary', 'voiding', 'substitute'];
const DEFAULT_FILTERS = {
    cteTypes: ['normal', 'complementary', 'voiding', 'substitute'],
    statuses: [],
    downloadable: 'all',
    voided: 'no',
    closed: 'all',
    compensated: 'all',
    autonomousFreight: 'all',
    complementaryDoc: 'all',
};
function isoDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}
function activeFilterCount(f) {
    let n = 0;
    const skip = new Set(['cteTypes', 'statuses', 'downloadable', 'voided', 'closed', 'compensated', 'autonomousFreight', 'complementaryDoc']);
    for (const [k, v] of Object.entries(f)) {
        if (skip.has(k))
            continue;
        if (typeof v === 'string' && v.trim())
            n++;
    }
    if ((f.statuses?.length ?? 0) > 0)
        n++;
    if ((f.cteTypes?.length ?? 4) < 4)
        n++;
    if (f.downloadable && f.downloadable !== 'all')
        n++;
    for (const k of ['voided', 'closed', 'compensated', 'autonomousFreight', 'complementaryDoc']) {
        if (f[k] && f[k] !== (DEFAULT_FILTERS[k] ?? 'all'))
            n++;
    }
    return n;
}
function toCsv(rows) {
    const head = [
        'Status', 'Tipo', 'CT-e', 'Serie', 'Chave', 'Emissao', 'Pagador', 'Remetente',
        'Destinatario', 'Cidade', 'UF', 'Placa', 'Motorista', 'Notas', 'Frete', 'Carga',
    ];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [
        SEFAZ_STATUS_LABELS[r.sefaz_status] ?? r.sefaz_status,
        CTE_TYPE_LABELS[r.cte_type] ?? r.cte_type,
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
    const resendCte = useResendCte();
    const deleteCte = useDeleteFailedCTe();
    const pollStatus = usePollCteStatus();
    const [draft, setDraft] = useState(DEFAULT_FILTERS);
    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [checked, setChecked] = useState(new Set());
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkProgress, setBulkProgress] = useState(null);
    const { data: rowsData = [], isLoading, isFetching, refetch } = useCteSearch(filters);
    const { sortedItems: rows, requestSort, sortConfig } = useSortableData(rowsData);
    // Polling automático para documentos em cancelamento ou transmissão
    const pollIntervalRef = useRef(null);
    const pollingIdsRef = useRef(new Set());
    useEffect(() => {
        const transientRows = rows.filter(r => r.hub_document_id &&
            (r.sefaz_status === 'cancelling' || r.sefaz_status === 'processing'));
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
        }
        else {
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
    function apply(next) {
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
    function toggleType(t) {
        const cur = new Set(draft.cteTypes ?? []);
        if (cur.has(t))
            cur.delete(t);
        else
            cur.add(t);
        setDraft({ ...draft, cteTypes: Array.from(cur) });
    }
    function toggleStatus(s) {
        const cur = new Set(filters.statuses ?? []);
        if (cur.has(s))
            cur.delete(s);
        else
            cur.add(s);
        apply({ statuses: Array.from(cur) });
    }
    function setPeriod(days) {
        apply({
            issueDateStart: days === null ? '' : isoDaysAgo(days),
            issueDateEnd: '',
        });
    }
    const downloadableRows = useMemo(() => rows.filter(canDownloadCte), [rows]);
    const checkedRows = useMemo(() => rows.filter((r) => checked.has(r.id)), [rows, checked]);
    const cities = useMemo(() => {
        const map = new Map();
        for (const r of rows) {
            const c = (r.recipient_city || '').trim();
            if (!c)
                continue;
            map.set(c, (map.get(c) ?? 0) + 1);
        }
        return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
    }, [rows]);
    const totals = useMemo(() => {
        let freight = 0, cargo = 0, authorized = 0, downloadable = 0;
        for (const r of rows) {
            freight += r.freight_value;
            cargo += r.cargo_value;
            if (r.sefaz_status === 'processed')
                authorized++;
            if (canDownloadCte(r))
                downloadable++;
        }
        return { count: rows.length, freight, cargo, authorized, downloadable };
    }, [rows]);
    const selectedTotals = useMemo(() => {
        let freight = 0;
        for (const r of checkedRows)
            freight += r.freight_value;
        return { freight };
    }, [checkedRows]);
    function toggleRow(id) {
        setChecked((prev) => {
            const next = new Set(prev);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    }
    function toggleAll() {
        setChecked((prev) => prev.size === downloadableRows.length ? new Set() : new Set(downloadableRows.map((r) => r.id)));
    }
    async function bulkDownload(format) {
        if (checkedRows.length === 0)
            return;
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
            fn(summary.title, { id: toastId, description: summary.description, duration: 12000 });
        }
        catch (e) {
            toast.error('Falha no download em massa', { id: toastId, description: e?.message, duration: 12000 });
        }
        finally {
            setBulkBusy(false);
            setBulkProgress(null);
        }
    }
    async function oneFile(row, format, view = false) {
        const filename = cteFileName(row, format);
        const toastId = toast.loading(`${view ? 'Abrindo' : 'Baixando'} ${format.toUpperCase()}...`);
        try {
            const blob = await fetchCteBlob(row, format);
            if (view)
                openBlob(blob, filename);
            else
                saveBlob(blob, filename);
            toast.success(`${format.toUpperCase()} ${view ? 'aberto' : 'baixado'}`, { id: toastId });
        }
        catch (e) {
            toast.error(`Falha ao obter ${format.toUpperCase()}`, { id: toastId, description: e?.message });
        }
    }
    function exportCsv() {
        if (rows.length === 0)
            return;
        const stamp = new Date().toISOString().slice(0, 10);
        saveBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `consulta-ctes-${stamp}.csv`);
        toast.success(`CSV com ${rows.length} registro(s) gerado`);
    }
    async function handleCancel(row) {
        const motive = window.prompt('Justificativa para o cancelamento (mínimo 15 caracteres):');
        if (!motive)
            return;
        try {
            await cancelCte.mutateAsync({ fiscalDocumentId: row.id, justificativa: motive });
            toast.success('Cancelamento solicitado com sucesso');
        }
        catch (e) {
            // toast já disparado pelo hook
        }
    }
    async function handleDelete(row) {
        if (!window.confirm('Deseja excluir este registro de erro? Esta ação é irreversível e serve apenas para limpar tentativas que falharam.'))
            return;
        await deleteCte.mutateAsync(row.id);
    }
    async function handleResend(row) {
        try {
            await resendCte.mutateAsync(row.id);
            toast.success('CT-e marcado para reenvio');
        }
        catch (e) {
            toast.error('Falha ao reenviar', { description: e?.message });
        }
    }
    const activeCount = activeFilterCount(filters);
    return (_jsxs("div", { className: "flex flex-col gap-4 p-4", children: [
            _jsx(PendingInvoicesBanner, { from: "search" }), _jsxs("header", { className: "flex items-center justify-between flex-wrap gap-2", children: [
                    _jsxs("div", { children: [
                            _jsx("h1", { className: "text-2xl font-semibold", children: "Consulta CT-e" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Busca nos CT-e emitidos (rascunhos e transmitidos) com download em lote de DACTE e XML." })
                        ] }), _jsxs("div", { className: "flex items-center gap-2", children: [
                            _jsxs(Badge, { variant: "outline", children: [totals.count, " registro(s)"] }), _jsxs(Button, { variant: "outline", size: "sm", onClick: exportCsv, disabled: rows.length === 0, children: [
                                    _jsx(TableIcon, { className: "h-4 w-4" }),
                                    " CSV"] }), _jsxs(Button, { variant: "outline", size: "sm", onClick: () => refetch(), disabled: isFetching, children: [
                                    _jsx(RefreshCw, { className: `h-4 w-4 ${isFetching ? 'animate-spin' : ''}` }),
                                    " Atualizar"] })
                        ] })
                ] }), _jsxs(Card, { className: "p-4 flex flex-col gap-3", children: [
                    _jsxs("div", { className: "flex flex-wrap items-end gap-2", children: [
                            _jsx("div", { className: "flex-1 min-w-[240px]", children: _jsx(Field, { label: "Busca r\u00E1pida (n\u00BA, chave, cliente, cidade, placa, NF)", children: _jsxs("div", { className: "flex gap-2", children: [
                                            _jsx(Input, { value: draft.text ?? '', placeholder: "Ex.: 1234, Santiago, JANAUBA, ABC1D23", onChange: (e) => setDraft({ ...draft, text: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter')
                                                    apply(); } }), _jsxs(Button, { size: "sm", onClick: () => apply(), children: [
                                                    _jsx(Search, { className: "h-4 w-4" }),
                                                    " Buscar"] })
                                        ] }) }) }), _jsx(Field, { label: "Emiss\u00E3o \u2014 In\u00EDcio", className: "w-[150px]", children: _jsx(Input, { type: "date", value: draft.issueDateStart ?? '', onChange: (e) => apply({ issueDateStart: e.target.value }) }) }), _jsx(Field, { label: "Emiss\u00E3o \u2014 Fim", className: "w-[150px]", children: _jsx(Input, { type: "date", value: draft.issueDateEnd ?? '', onChange: (e) => apply({ issueDateEnd: e.target.value }) }) }), _jsx(Field, { label: "Cidade destino", className: "w-[200px]", children: _jsxs("select", { className: "h-9 rounded-md border bg-background px-2 text-sm", value: filters.recipientCity ?? '', onChange: (e) => apply({ recipientCity: e.target.value }), children: [
                                        _jsx("option", { value: "", children: "Todas as cidades" }), cities.map(([c, n]) => _jsxs("option", { value: c, children: [c, " (", n, ")"] }, c))] }) })
                        ] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
                            _jsx("span", { className: "text-[11px] uppercase tracking-wide text-muted-foreground", children: "Per\u00EDodo" }), [{ l: 'Hoje', d: 0 }, { l: '7 dias', d: 7 }, { l: '30 dias', d: 30 }, { l: '90 dias', d: 90 }].map((p) => (_jsx(Button, { size: "sm", variant: "outline", onClick: () => setPeriod(p.d), children: p.l }, p.l))), _jsx(Button, { size: "sm", variant: "ghost", onClick: () => setPeriod(null), children: "Tudo" }), _jsx("span", { className: "ml-2 text-[11px] uppercase tracking-wide text-muted-foreground", children: "Status" }), QUICK_STATUSES.map((s) => {
                                const on = (filters.statuses ?? []).includes(s);
                                return (_jsx("button", { onClick: () => toggleStatus(s), className: `rounded-full border px-2.5 py-0.5 text-xs ${on ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground'}`, children: SEFAZ_STATUS_LABELS[s] ?? s }, s));
                            }), _jsx("button", { onClick: () => apply({ downloadable: filters.downloadable === 'yes' ? 'all' : 'yes' }), className: `rounded-full border px-2.5 py-0.5 text-xs ${filters.downloadable === 'yes' ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground'}`, children: "S\u00F3 com arquivo" }), _jsxs("div", { className: "ml-auto flex items-center gap-2", children: [activeCount > 0 && _jsxs(Badge, { variant: "secondary", children: [activeCount, " filtro(s) ativo(s)"] }), _jsxs(Button, { size: "sm", variant: "ghost", onClick: () => setShowAdvanced((v) => !v), children: [
                                            _jsx(FilterIcon, { className: "h-4 w-4" }),
                                            " Filtros avan\u00E7ados", showAdvanced ? _jsx(ChevronUp, { className: "h-4 w-4" }) : _jsx(ChevronDown, { className: "h-4 w-4" })] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: clear, children: [
                                            _jsx(X, { className: "h-4 w-4" }),
                                            " Limpar"] })
                                ] })
                        ] }), showAdvanced && (_jsxs("div", { className: "border-t pt-3 flex flex-col gap-3", children: [
                            _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3", children: [
                                    _jsx(Field, { label: "N\u00BA Doc", children: _jsx(Input, { value: draft.docNumber ?? '', onChange: (e) => setDraft({ ...draft, docNumber: e.target.value }) }) }), _jsx(Field, { label: "Chave de acesso", children: _jsx(Input, { value: draft.accessKey ?? '', onChange: (e) => setDraft({ ...draft, accessKey: e.target.value }) }) }), _jsx(Field, { label: "N\u00BA Interno", children: _jsx(Input, { value: draft.internalNumber ?? '', onChange: (e) => setDraft({ ...draft, internalNumber: e.target.value }) }) }), _jsx(Field, { label: "N\u00BA Ref.", children: _jsx(Input, { value: draft.referenceNumber ?? '', onChange: (e) => setDraft({ ...draft, referenceNumber: e.target.value }) }) }), _jsx(Field, { label: "S\u00E9rie", children: _jsx(Input, { value: draft.series ?? '', onChange: (e) => setDraft({ ...draft, series: e.target.value }) }) }), _jsx(Field, { label: "Nota Fiscal", children: _jsx(Input, { value: draft.invoiceNumber ?? '', onChange: (e) => setDraft({ ...draft, invoiceNumber: e.target.value }) }) })
                                ] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-3", children: [
                                    _jsx(Field, { label: "Remetente", children: _jsx(Input, { value: draft.remitter ?? '', onChange: (e) => setDraft({ ...draft, remitter: e.target.value }) }) }), _jsx(Field, { label: "Cliente/Destinat\u00E1rio", children: _jsx(Input, { value: draft.recipient ?? '', onChange: (e) => setDraft({ ...draft, recipient: e.target.value }) }) }), _jsx(Field, { label: "Munic\u00EDpio", children: _jsx(Input, { value: draft.recipientCity ?? '', onChange: (e) => setDraft({ ...draft, recipientCity: e.target.value }) }) }), _jsx(Field, { label: "Fornecedor/Pagador", children: _jsx(Input, { value: draft.payer ?? '', onChange: (e) => setDraft({ ...draft, payer: e.target.value }) }) })
                                ] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-3 gap-3", children: [
                                    _jsx(Field, { label: "Consignat\u00E1rio", children: _jsx(Input, { value: draft.consignee ?? '', onChange: (e) => setDraft({ ...draft, consignee: e.target.value }) }) }), _jsx(Field, { label: "Grp Pagador", children: _jsx(Input, { value: draft.payerGroup ?? '', onChange: (e) => setDraft({ ...draft, payerGroup: e.target.value }) }) }), _jsx(Field, { label: "Seguradora", children: _jsx(Input, { value: draft.insuranceCompany ?? '', onChange: (e) => setDraft({ ...draft, insuranceCompany: e.target.value }) }) })
                                ] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3", children: [
                                    _jsx(Field, { label: "Motorista", children: _jsx(Input, { value: draft.driverName ?? '', onChange: (e) => setDraft({ ...draft, driverName: e.target.value }) }) }), _jsx(Field, { label: "Placa", children: _jsx(Input, { value: draft.vehiclePlate ?? '', onChange: (e) => setDraft({ ...draft, vehiclePlate: e.target.value }) }) }), _jsx(Field, { label: "Placa Carreta", children: _jsx(Input, { value: draft.trailerPlate ?? '', onChange: (e) => setDraft({ ...draft, trailerPlate: e.target.value }) }) }), _jsx(Field, { label: "N\u00BA Contrato", children: _jsx(Input, { value: draft.contractNumber ?? '', onChange: (e) => setDraft({ ...draft, contractNumber: e.target.value }) }) }), _jsx(Field, { label: "N\u00BA Viagem", children: _jsx(Input, { value: draft.tripNumber ?? '', onChange: (e) => setDraft({ ...draft, tripNumber: e.target.value }) }) }), _jsx(Field, { label: "Romexp", children: _jsx(Input, { value: draft.romexpNumber ?? '', onChange: (e) => setDraft({ ...draft, romexpNumber: e.target.value }) }) })
                                ] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [
                                    _jsxs("div", { children: [
                                            _jsx("p", { className: "text-[11px] uppercase tracking-wide text-muted-foreground mb-2", children: "Tipo CT-e" }), _jsx("div", { className: "flex flex-wrap gap-3", children: ALL_CTE_TYPES.map((t) => (_jsxs("label", { className: "flex items-center gap-2 text-sm cursor-pointer", children: [
                                                        _jsx(Checkbox, { checked: (draft.cteTypes ?? []).includes(t), onCheckedChange: () => toggleType(t) }), CTE_TYPE_LABELS[t]] }, t))) })
                                        ] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-3 gap-3", children: [
                                            _jsx(TriRadio, { label: "Anulado", value: draft.voided ?? 'all', onChange: (v) => setDraft({ ...draft, voided: v }) }), _jsx(TriRadio, { label: "Encerrado", value: draft.closed ?? 'all', onChange: (v) => setDraft({ ...draft, closed: v }) }), _jsx(TriRadio, { label: "Compensado", value: draft.compensated ?? 'all', onChange: (v) => setDraft({ ...draft, compensated: v }) }), _jsx(TriRadio, { label: "Frete Aut\u00F4nomo", value: draft.autonomousFreight ?? 'all', onChange: (v) => setDraft({ ...draft, autonomousFreight: v }) }), _jsx(TriRadio, { label: "Doc. Complementar", value: draft.complementaryDoc ?? 'all', onChange: (v) => setDraft({ ...draft, complementaryDoc: v }) })
                                        ] })
                                ] }), _jsxs("div", { className: "flex items-center gap-2", children: [
                                    _jsxs(Button, { onClick: () => apply(), size: "sm", children: [
                                            _jsx(Search, { className: "h-4 w-4" }),
                                            " Aplicar filtros"] }), _jsxs(Button, { onClick: clear, variant: "outline", size: "sm", children: [
                                            _jsx(X, { className: "h-4 w-4" }),
                                            " Limpar"] })
                                ] })
                        ] }))] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-3", children: [
                    _jsxs(Card, { className: "p-3", children: [
                            _jsx("p", { className: "text-xs text-muted-foreground", children: "CT-e encontrados" }), _jsx("p", { className: "text-2xl font-semibold", children: totals.count })
                        ] }), _jsxs(Card, { className: "p-3", children: [
                            _jsx("p", { className: "text-xs text-muted-foreground", children: "Autorizados / com arquivo" }), _jsxs("p", { className: "text-2xl font-semibold", children: [totals.authorized, " / ", totals.downloadable] })
                        ] }), _jsxs(Card, { className: "p-3", children: [
                            _jsx("p", { className: "text-xs text-muted-foreground", children: "Total Frete" }), _jsx("p", { className: "text-2xl font-semibold", children: BRL(totals.freight) })
                        ] }), _jsxs(Card, { className: "p-3", children: [
                            _jsx("p", { className: "text-xs text-muted-foreground", children: "Total Carga" }), _jsx("p", { className: "text-2xl font-semibold", children: BRL(totals.cargo) })
                        ] })
                ] }), (checkedRows.length > 0 || bulkBusy) && (_jsxs(Card, { className: "p-3 flex flex-wrap items-center gap-3 border-primary/40", children: [
                    _jsxs("span", { className: "text-sm font-medium", children: [checkedRows.length, " selecionado(s) \u2014 frete ", BRL(selectedTotals.freight)] }), _jsx("span", { className: "text-xs text-muted-foreground", children: bulkProgress
                            ? `Baixando ${bulkProgress.done}/${bulkProgress.total} do Hub Fiscal...`
                            : 'O PDF sai em arquivo único (uma nota por página); XML sai em ZIP.' }), _jsxs("div", { className: "ml-auto flex flex-wrap items-center gap-2", children: [
                            _jsx(Button, { size: "sm", variant: "outline", onClick: toggleAll, disabled: bulkBusy, children: checked.size === downloadableRows.length ? 'Limpar seleção' : `Selecionar todos com arquivo (${downloadableRows.length})` }), _jsxs(Button, { size: "sm", onClick: () => bulkDownload('pdf'), disabled: bulkBusy, children: [
                                    _jsx(Download, { className: "h-4 w-4" }),
                                    " Baixar PDF \u00FAnico"] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => bulkDownload('xml'), disabled: bulkBusy, children: [
                                    _jsx(FileDown, { className: "h-4 w-4" }),
                                    " Baixar XMLs (ZIP)"] })
                        ] })
                ] })), _jsx(Card, { className: "overflow-hidden", children: _jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [
                            _jsx(TableHeader, { className: "bg-muted/50 text-xs uppercase", children: _jsxs(TableRow, { children: [
                                        _jsx(TableHead, { className: "px-3 py-2 w-8", children: _jsx(Checkbox, { checked: downloadableRows.length > 0 && checked.size === downloadableRows.length, onCheckedChange: toggleAll, "aria-label": "Selecionar todos" }) }), _jsx(TableHead, { sortKey: "sefaz_status", sortConfig: sortConfig, onSort: requestSort, children: "Status" }), _jsx(TableHead, { sortKey: "cte_type", sortConfig: sortConfig, onSort: requestSort, children: "Tipo" }), _jsx(TableHead, { sortKey: "cte_number", sortConfig: sortConfig, onSort: requestSort, children: "N\u00BA CT-e" }), _jsx(TableHead, { sortKey: "cte_series", sortConfig: sortConfig, onSort: requestSort, children: "S\u00E9r." }), _jsx(TableHead, { sortKey: "issued_at", sortConfig: sortConfig, onSort: requestSort, children: "Emiss\u00E3o" }), _jsx(TableHead, { sortKey: "remitter", sortConfig: sortConfig, onSort: requestSort, children: "Remetente" }), _jsx(TableHead, { sortKey: "recipient", sortConfig: sortConfig, onSort: requestSort, children: "Destinat\u00E1rio" }), _jsx(TableHead, { sortKey: "recipient_city", sortConfig: sortConfig, onSort: requestSort, children: "Cidade / UF" }), _jsx(TableHead, { sortKey: "vehicle_plate", sortConfig: sortConfig, onSort: requestSort, children: "Placa" }), _jsx(TableHead, { sortKey: "freight_value", sortConfig: sortConfig, onSort: requestSort, className: "text-right", children: "Frete" }), _jsx(TableHead, { className: "text-right", children: "A\u00E7\u00F5es" })
                                    ] }) }), _jsxs(TableBody, { children: [isLoading && _jsx(TableRow, { children: _jsx(TableCell, { colSpan: 12, className: "text-center text-muted-foreground py-8", children: "Carregando\u2026" }) }), !isLoading && rows.length === 0 && (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 12, className: "text-center text-muted-foreground py-8", children: "Nenhum CT-e encontrado com os filtros atuais." }) })), rows.map((r) => {
                                        const has = canDownloadCte(r);
                                        return (_jsxs(TableRow, { className: `border-t hover:bg-muted/30 ${checked.has(r.id) ? 'bg-primary/5' : ''}`, children: [
                                                _jsx(TableCell, { className: "px-3 py-2", children: _jsx(Checkbox, { checked: checked.has(r.id), onCheckedChange: () => toggleRow(r.id), disabled: !has, "aria-label": `Selecionar ${cteLabel(r)}` }) }), _jsx(TableCell, { className: "px-3 py-2", children: _jsxs("div", { className: "flex flex-col gap-0.5", children: [
                                                            _jsx(StatusPill, { status: r.sefaz_status }), r.sefaz_status_reason && (_jsx("span", { className: "text-[10px] text-destructive max-w-[200px] whitespace-normal font-medium mt-1 leading-tight", title: r.sefaz_status_reason, children: r.sefaz_status_reason }))] }) }), _jsx(TableCell, { className: "px-3 py-2 text-xs", children: CTE_TYPE_LABELS[r.cte_type] ?? r.cte_type }), _jsx(TableCell, { className: "px-3 py-2 font-mono", children: r.cte_number ?? '—' }), _jsx(TableCell, { className: "px-3 py-2", children: r.cte_series ?? '—' }), _jsx(TableCell, { className: "px-3 py-2 text-xs", children: r.issued_at ? new Date(r.issued_at).toLocaleDateString('pt-BR') : '—' }), _jsx(TableCell, { className: "px-3 py-2 text-xs truncate max-w-[150px]", title: r.remitter ?? '', children: r.remitter ?? '—' }), _jsx(TableCell, { className: "px-3 py-2 text-xs truncate max-w-[150px]", title: r.recipient ?? '', children: r.recipient ?? '—' }), _jsx(TableCell, { className: "px-3 py-2 text-xs", children: [r.recipient_city, r.recipient_state].filter(Boolean).join(' / ') || '—' }), _jsx(TableCell, { className: "px-3 py-2 font-mono text-xs", children: r.vehicle_plate ?? '—' }), _jsx(TableCell, { className: "px-3 py-2 text-right text-xs", children: BRL(r.freight_value) }), _jsx(TableCell, { className: "px-3 py-2 text-right", children: _jsxs("div", { className: "inline-flex gap-1", children: [
                                                            _jsx(Button, { size: "sm", variant: "ghost", title: "Visualizar DACTE", disabled: !has, onClick: () => oneFile(r, 'pdf', true), children: _jsx(Eye, { className: "h-4 w-4" }) }), _jsx(Button, { size: "sm", variant: "ghost", title: "Baixar PDF", disabled: !has, onClick: () => oneFile(r, 'pdf'), children: _jsx(FileText, { className: "h-4 w-4" }) }), _jsx(Button, { size: "sm", variant: "ghost", title: "Baixar XML", disabled: !has, onClick: () => oneFile(r, 'xml'), children: _jsx(FileDown, { className: "h-4 w-4" }) }), (r.sefaz_status === 'processed' || r.sefaz_status === 'processed_error' || r.sefaz_status === 'authorized' || r.sefaz_status === 'rejected') && r.hub_document_id && r.source === 'hub' && (_jsx(Button, { size: "sm", variant: "ghost", className: "text-destructive hover:text-destructive hover:bg-destructive/10", title: "Cancelar CT-e", disabled: cancelCte.isPending, onClick: () => handleCancel(r), children: _jsx(Ban, { className: "h-4 w-4" }) })), r.sefaz_status.endsWith('_error') && (_jsx(Button, { size: "sm", variant: "ghost", title: "Reenviar \u00E0 SEFAZ", disabled: resendCte.isPending, onClick: () => handleResend(r), children: _jsx(RefreshCw, { className: "h-4 w-4" }) })), (r.sefaz_status === 'error' || r.sefaz_status === 'rejected' || r.sefaz_status === 'sent_error' || r.sefaz_status === 'processed_error' || r.sefaz_status === 'sefaz_error') && (_jsx(Button, { size: "sm", variant: "ghost", className: "text-destructive hover:text-destructive hover:bg-destructive/10", title: r.hub_document_id ? "Remover rascunho (possui ID no Hub)" : "Excluir registro de erro", disabled: deleteCte.isPending, onClick: () => handleDelete(r), children: _jsx(Trash2, { className: "h-4 w-4" }) }))] }) })
                                            ] }, r.id));
                                    })] })
                        ] }) }) })
        ] }));
}
