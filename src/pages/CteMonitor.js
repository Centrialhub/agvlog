import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from '@/components/ui/dialog';
import { useCteMonitor, useCteSefazEvents, useResendCte, SEFAZ_STATUS_LABELS, SEFAZ_STATUS_TONE, SEFAZ_STATUSES, } from '@/hooks/useCteMonitor';
import { FileText, FileDown, RefreshCw, Search, Filter as FilterIcon, X, AlertCircle, Eye, Ban, } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { useCancelCTe } from '@/hooks/useIssueCTe';
import { PendingInvoicesBanner } from '@/components/billing/PendingInvoicesBanner';
import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import { runBulkDownload, summarizeBulkResult } from '@/lib/fiscal/bulkFileMerge';
import { useSortableData } from '@/hooks/useSortableData';
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from '@/components/ui/table';
function saveBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}
function openBlob(blob, filename) {
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
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}
/** Obtém o arquivo do CT-e (sob demanda no Hub, ou link em cache como último recurso). */
async function fetchRowBlob(row, format) {
    if (row.hub_document_id) {
        return hubFiscal.file(row.hub_document_id, format, { type: 'cte', emissionId: row.emission_id });
    }
    const cachedUrl = format === 'pdf' ? row.pdf_url : row.xml_url;
    if (cachedUrl) {
        const res = await fetch(cachedUrl);
        if (res.ok) {
            const blob = await res.blob();
            if (blob.size > 0)
                return blob;
        }
    }
    throw new Error(row.source === 'hub'
        ? 'Sem id do Hub Fiscal — sincronize a emissão antes de baixar.'
        : 'Rascunho local nunca transmitido ao Hub Fiscal/SEFAZ.');
}
async function downloadHubFile(row, format, opts = {}) {
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
                        if (opts.view)
                            openBlob(blob, filename);
                        else
                            saveBlob(blob, filename);
                        return;
                    }
                }
            }
            catch { /* segue para a mensagem de indisponível */ }
        }
        const description = row.source === 'hub'
            ? 'Este CT-e ainda não tem id do Hub Fiscal — sincronize a emissão antes de baixar.'
            : 'Este registro é um rascunho local que nunca foi transmitido ao Hub Fiscal/SEFAZ.';
        if (opts.silent)
            throw new Error(description);
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
        if (opts.view)
            openBlob(blob, filename);
        else
            saveBlob(blob, filename);
        if (!opts.silent)
            toast.success(`${label} ${opts.view ? 'aberto' : 'baixado'}`, { id: toastId });
    }
    catch (e) {
        if (opts.silent)
            throw e;
        toast.error(`Falha ao ${opts.view ? 'abrir' : 'baixar'} ${label}`, { id: toastId, description: e?.message });
    }
}
const TONE_CLASS = {
    default: 'bg-secondary text-secondary-foreground',
    success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
    danger: 'bg-destructive/15 text-destructive border border-destructive/30',
    muted: 'bg-muted text-muted-foreground',
};
function StatusPill({ status }) {
    const tone = SEFAZ_STATUS_TONE[status] ?? 'default';
    return (_jsx("span", { className: `inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`, children: SEFAZ_STATUS_LABELS[status] ?? status }));
}
function Field({ label, children, className = '' }) {
    return (_jsxs("div", { className: `flex flex-col gap-1 ${className}`, children: [
            _jsx("label", { className: "text-[11px] uppercase tracking-wide text-muted-foreground", children: label }), children] }));
}
// Mostra todos os status por padrão — CT-es autorizadas (processed) precisam
// aparecer no monitor para download de PDF/XML.
const DEFAULT_STATUSES = [];
export default function CteMonitor() {
    const [filters, setFilters] = useState({
        statuses: DEFAULT_STATUSES,
        correctionLetter: 'all',
    });
    const [draft, setDraft] = useState(filters);
    const [selected, setSelected] = useState(null);
    const [checked, setChecked] = useState(new Set());
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkProgress, setBulkProgress] = useState(null);
    const { data: rowsData = [], isLoading, refetch, isFetching } = useCteMonitor(filters);
    const resend = useResendCte();
    const { sortedItems: rows, requestSort, sortConfig } = useSortableData(rowsData);
    const downloadableRows = useMemo(() => rows.filter((r) => r.hub_document_id || r.pdf_url || r.xml_url), [rows]);
    const checkedRows = useMemo(() => rows.filter((r) => checked.has(r.id)), [rows, checked]);
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
                outputBase: `ctes-${format}-${stamp}`,
                fetchOne: (row) => fetchRowBlob(row, format),
                labelOf: (row) => `CT-e ${row.cte_number || row.access_key || row.id.slice(0, 8)}`,
                filenameOf: (row) => `cte-${row.access_key || row.cte_number || row.id}.${format}`,
                onProgress: (doneCount, all, label) => {
                    setBulkProgress({ done: doneCount, total: all });
                    toast.loading(`Baixando ${doneCount}/${all} — ${label}`, { id: toastId });
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
    const counts = useMemo(() => {
        const c = { total: rows.length, errors: 0, processed: 0, pending: 0, cancelled: 0 };
        for (const r of rows) {
            if (r.sefaz_status.endsWith('_error'))
                c.errors++;
            else if (r.sefaz_status === 'processed')
                c.processed++;
            else if (r.sefaz_status === 'pending')
                c.pending++;
            else if (r.sefaz_status === 'cancelled')
                c.cancelled++;
        }
        return c;
    }, [rows]);
    function applyFilters() {
        setFilters(draft);
    }
    function clearFilters() {
        const cleared = { statuses: DEFAULT_STATUSES, correctionLetter: 'all' };
        setDraft(cleared);
        setFilters(cleared);
        setChecked(new Set());
    }
    function toggleStatus(s) {
        const cur = new Set(draft.statuses ?? []);
        if (cur.has(s))
            cur.delete(s);
        else
            cur.add(s);
        setDraft({ ...draft, statuses: Array.from(cur) });
    }
    async function downloadXml(row) {
        await downloadHubFile(row, 'xml');
    }
    async function downloadPdf(row) {
        await downloadHubFile(row, 'pdf');
    }
    return (_jsx(_Fragment, { children: _jsxs("div", { className: "flex flex-col gap-4 p-4", children: [
                _jsx(PendingInvoicesBanner, { from: "monitor" }), _jsxs("header", { className: "flex items-center justify-between flex-wrap gap-2", children: [
                        _jsxs("div", { children: [
                                _jsx("h1", { className: "text-2xl font-semibold", children: "Monitor DOC-e (CT-e)" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Acompanhamento dos CT-e enviados \u00E0 SEFAZ \u2014 status, motivo de erro, PDF/XML e hist\u00F3rico de eventos." })
                            ] }), _jsxs("div", { className: "flex items-center gap-2", children: [
                                _jsxs(Badge, { variant: "outline", children: [counts.total, " registro(s)"] }), _jsxs(Button, { variant: "outline", size: "sm", onClick: () => refetch(), disabled: isFetching, children: [
                                        _jsx(RefreshCw, { className: `h-4 w-4 ${isFetching ? 'animate-spin' : ''}` }),
                                        " Atualizar"] })
                            ] })
                    ] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-5 gap-3", children: [
                        _jsxs(Card, { className: "p-3", children: [
                                _jsx("p", { className: "text-xs text-muted-foreground", children: "Total" }), _jsx("p", { className: "text-2xl font-semibold", children: counts.total })
                            ] }), _jsxs(Card, { className: "p-3", children: [
                                _jsx("p", { className: "text-xs text-muted-foreground", children: "Processados" }), _jsx("p", { className: "text-2xl font-semibold text-emerald-600", children: counts.processed })
                            ] }), _jsxs(Card, { className: "p-3", children: [
                                _jsx("p", { className: "text-xs text-muted-foreground", children: "Erros" }), _jsx("p", { className: "text-2xl font-semibold text-destructive", children: counts.errors })
                            ] }), _jsxs(Card, { className: "p-3", children: [
                                _jsx("p", { className: "text-xs text-muted-foreground", children: "Pendentes" }), _jsx("p", { className: "text-2xl font-semibold", children: counts.pending })
                            ] }), _jsxs(Card, { className: "p-3", children: [
                                _jsx("p", { className: "text-xs text-muted-foreground", children: "Cancelados" }), _jsx("p", { className: "text-2xl font-semibold text-muted-foreground", children: counts.cancelled })
                            ] })
                    ] }), _jsxs(Card, { className: "p-4", children: [
                        _jsxs("div", { className: "flex items-center gap-2 mb-3", children: [
                                _jsx(FilterIcon, { className: "h-4 w-4" }), _jsx("h2", { className: "font-medium", children: "Filtros" })
                            ] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3", children: [
                                _jsx(Field, { label: "N\u00BA Doc", children: _jsx(Input, { value: draft.docNumber ?? '', onChange: (e) => setDraft({ ...draft, docNumber: e.target.value }) }) }), _jsx(Field, { label: "Pagador", children: _jsx(Input, { value: draft.payer ?? '', onChange: (e) => setDraft({ ...draft, payer: e.target.value }) }) }), _jsx(Field, { label: "N\u00BA Interno", children: _jsx(Input, { value: draft.internalNumber ?? '', onChange: (e) => setDraft({ ...draft, internalNumber: e.target.value }) }) }), _jsx(Field, { label: "N\u00BA Compensa\u00E7\u00E3o / Ref.", children: _jsx(Input, { value: draft.referenceNumber ?? '', onChange: (e) => setDraft({ ...draft, referenceNumber: e.target.value }) }) }), _jsx(Field, { label: "N\u00BA Protocolo", children: _jsx(Input, { value: draft.protocolNumber ?? '', onChange: (e) => setDraft({ ...draft, protocolNumber: e.target.value }) }) }), _jsx(Field, { label: "Chave de Acesso (44)", children: _jsx(Input, { value: draft.accessKey ?? '', onChange: (e) => setDraft({ ...draft, accessKey: e.target.value }) }) }), _jsx(Field, { label: "Placa", children: _jsx(Input, { value: draft.plate ?? '', onChange: (e) => setDraft({ ...draft, plate: e.target.value }) }) }), _jsx(Field, { label: "Motorista", children: _jsx(Input, { value: draft.driver ?? '', onChange: (e) => setDraft({ ...draft, driver: e.target.value }) }) }), _jsx(Field, { label: "S\u00E9rie", children: _jsx(Input, { value: draft.series ?? '', onChange: (e) => setDraft({ ...draft, series: e.target.value }) }) }), _jsx(Field, { label: "Filial", children: _jsx(Input, { value: draft.branch ?? '', onChange: (e) => setDraft({ ...draft, branch: e.target.value }) }) }), _jsx(Field, { label: "Grupo Empresa", children: _jsx(Input, { value: draft.companyGroup ?? '', onChange: (e) => setDraft({ ...draft, companyGroup: e.target.value }) }) }), _jsx(Field, { label: "Grupo Pagador", children: _jsx(Input, { value: draft.payerGroup ?? '', onChange: (e) => setDraft({ ...draft, payerGroup: e.target.value }) }) }), _jsx(Field, { label: "Processamento \u2014 In\u00EDcio", children: _jsx(Input, { type: "date", value: draft.processedStart ?? '', onChange: (e) => setDraft({ ...draft, processedStart: e.target.value }) }) }), _jsx(Field, { label: "Processamento \u2014 Fim", children: _jsx(Input, { type: "date", value: draft.processedEnd ?? '', onChange: (e) => setDraft({ ...draft, processedEnd: e.target.value }) }) }), _jsx(Field, { label: "Emiss\u00E3o \u2014 In\u00EDcio", children: _jsx(Input, { type: "date", value: draft.issuedStart ?? '', onChange: (e) => setDraft({ ...draft, issuedStart: e.target.value }) }) }), _jsx(Field, { label: "Emiss\u00E3o \u2014 Fim", children: _jsx(Input, { type: "date", value: draft.issuedEnd ?? '', onChange: (e) => setDraft({ ...draft, issuedEnd: e.target.value }) }) })
                            ] }), _jsxs("div", { className: "mt-4", children: [
                                _jsx("p", { className: "text-[11px] uppercase tracking-wide text-muted-foreground mb-2", children: "Status (DOC-e)" }), _jsx("div", { className: "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2", children: SEFAZ_STATUSES.map((s) => (_jsxs("label", { className: "flex items-center gap-2 text-sm cursor-pointer", children: [
                                            _jsx(Checkbox, { checked: (draft.statuses ?? []).includes(s), onCheckedChange: () => toggleStatus(s) }), _jsx("span", { children: SEFAZ_STATUS_LABELS[s] })
                                        ] }, s))) })
                            ] }), _jsxs("div", { className: "mt-4 flex items-center gap-4 flex-wrap", children: [
                                _jsx("span", { className: "text-[11px] uppercase tracking-wide text-muted-foreground", children: "Carta de Corre\u00E7\u00E3o" }), ['all', 'yes', 'no'].map((v) => (_jsxs("label", { className: "flex items-center gap-2 text-sm cursor-pointer", children: [
                                        _jsx("input", { type: "radio", name: "cce", checked: (draft.correctionLetter ?? 'all') === v, onChange: () => setDraft({ ...draft, correctionLetter: v }) }), _jsx("span", { children: v === 'all' ? 'Todos' : v === 'yes' ? 'Sim' : 'Não' })
                                    ] }, v)))] }), _jsxs("div", { className: "mt-4 flex items-center gap-2", children: [
                                _jsxs(Button, { onClick: applyFilters, size: "sm", children: [
                                        _jsx(Search, { className: "h-4 w-4" }),
                                        " Aplicar filtros"] }), _jsxs(Button, { onClick: clearFilters, variant: "outline", size: "sm", children: [
                                        _jsx(X, { className: "h-4 w-4" }),
                                        " Limpar"] })
                            ] })
                    ] }), _jsxs(Card, { className: "overflow-hidden", children: [
                        _jsxs("div", { className: "flex items-center justify-between gap-3 flex-wrap border-b bg-muted/30 px-3 py-2", children: [
                                _jsx("span", { className: "text-sm text-muted-foreground", children: bulkProgress
                                        ? `Baixando ${bulkProgress.done}/${bulkProgress.total} do Hub Fiscal...`
                                        : checkedRows.length > 0
                                            ? `${checkedRows.length} CT-e(s) selecionado(s) — download em arquivo único`
                                            : 'Filtre e selecione CT-es para baixar tudo em um único arquivo' }), _jsxs("div", { className: "flex items-center gap-2", children: [
                                        _jsxs(Button, { size: "sm", variant: "outline", disabled: downloadableRows.length === 0 || bulkBusy, onClick: () => setChecked(new Set(downloadableRows.map((r) => r.id))), children: ["Selecionar todos os filtrados (", downloadableRows.length, ")"] }), _jsxs(Button, { size: "sm", disabled: checkedRows.length === 0 || bulkBusy, onClick: () => bulkDownload('pdf'), children: [
                                                _jsx(FileText, { className: "h-4 w-4" }),
                                                " Baixar PDF \u00FAnico"] }), _jsxs(Button, { size: "sm", variant: "outline", disabled: checkedRows.length === 0 || bulkBusy, onClick: () => bulkDownload('xml'), children: [
                                                _jsx(FileDown, { className: "h-4 w-4" }),
                                                " Baixar XMLs (ZIP)"] })
                                    ] })
                            ] }), _jsx("div", { className: "overflow-x-auto", children: _jsxs(Table, { children: [
                                    _jsx(TableHeader, { className: "bg-muted/50 text-xs uppercase", children: _jsxs(TableRow, { children: [
                                                _jsx(TableHead, { className: "px-3 py-2 w-8", children: _jsx(Checkbox, { checked: downloadableRows.length > 0 && checked.size === downloadableRows.length, onCheckedChange: toggleAll, "aria-label": "Selecionar todos" }) }), _jsx(TableHead, { className: "px-3 py-2", sortKey: "sefaz_status", sortConfig: sortConfig, onSort: requestSort, children: "Status" }), _jsx(TableHead, { className: "px-3 py-2", sortKey: "cte_number", sortConfig: sortConfig, onSort: requestSort, children: "N\u00BA CT-e" }), _jsx(TableHead, { className: "px-3 py-2", sortKey: "cte_series", sortConfig: sortConfig, onSort: requestSort, children: "S\u00E9rie" }), _jsx(TableHead, { className: "px-3 py-2", sortKey: "payer_name", sortConfig: sortConfig, onSort: requestSort, children: "Pagador" }), _jsx(TableHead, { className: "px-3 py-2", sortKey: "recipient_city", sortConfig: sortConfig, onSort: requestSort, children: "Cidade / UF" }), _jsx(TableHead, { className: "px-3 py-2", sortKey: "vehicle_plate", sortConfig: sortConfig, onSort: requestSort, children: "Placa" }), _jsx(TableHead, { className: "px-3 py-2", sortKey: "protocol_number", sortConfig: sortConfig, onSort: requestSort, children: "Protocolo" }), _jsx(TableHead, { className: "px-3 py-2", sortKey: "issued_at", sortConfig: sortConfig, onSort: requestSort, children: "Emiss\u00E3o" }), _jsx(TableHead, { className: "px-3 py-2", sortKey: "sefaz_status_reason", sortConfig: sortConfig, onSort: requestSort, children: "Motivo / Erro" }), _jsx(TableHead, { className: "text-right px-3 py-2", children: "A\u00E7\u00F5es" })
                                            ] }) }), _jsxs(TableBody, { children: [isLoading && (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 11, className: "text-center text-muted-foreground py-8", children: "Carregando\u2026" }) })), !isLoading && rows.length === 0 && (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 11, className: "text-center text-muted-foreground py-8", children: "Nenhum CT-e encontrado com os filtros atuais." }) })), rows.map((r) => (_jsxs(TableRow, { className: "border-t hover:bg-muted/30 cursor-pointer", onClick: () => setSelected(r), children: [
                                                    _jsx(TableCell, { className: "px-3 py-2", onClick: (e) => e.stopPropagation(), children: _jsx(Checkbox, { checked: checked.has(r.id), onCheckedChange: () => toggleRow(r.id), disabled: !r.hub_document_id && !r.pdf_url && !r.xml_url, "aria-label": "Selecionar CT-e" }) }), _jsx(TableCell, { className: "px-3 py-2", children: _jsx(StatusPill, { status: r.sefaz_status }) }), _jsx(TableCell, { className: "px-3 py-2 font-mono", children: r.cte_number ?? '—' }), _jsx(TableCell, { className: "px-3 py-2", children: r.cte_series ?? '—' }), _jsx(TableCell, { className: "px-3 py-2", children: r.payer_name ?? r.recipient ?? '—' }), _jsxs(TableCell, { className: "px-3 py-2 text-xs truncate max-w-[200px]", title: `${r.recipient_city} / ${r.recipient_state}`, children: [r.recipient_city ?? '—', " / ", r.recipient_state ?? '—'] }), _jsx(TableCell, { className: "px-3 py-2 font-mono", children: r.vehicle_plate ?? '—' }), _jsx(TableCell, { className: "px-3 py-2 font-mono text-xs", children: r.protocol_number ?? '—' }), _jsx(TableCell, { className: "px-3 py-2 text-xs", children: r.issued_at ? new Date(r.issued_at).toLocaleDateString('pt-BR') : '—' }), _jsx(TableCell, { className: "px-3 py-2 text-xs max-w-xs truncate", title: r.sefaz_status_reason ?? '', children: r.sefaz_status_reason ? (_jsxs("span", { className: "inline-flex items-center gap-1 text-destructive", children: [
                                                                _jsx(AlertCircle, { className: "h-3 w-3" }),
                                                                " ", r.sefaz_status_reason] })) : '—' }), _jsx(TableCell, { className: "px-3 py-2 text-right", onClick: (e) => e.stopPropagation(), children: _jsxs("div", { className: "inline-flex gap-1", children: [
                                                                _jsx(Button, { size: "sm", variant: "ghost", title: "Visualizar DACTE (PDF)", onClick: () => downloadHubFile(r, 'pdf', { view: true }), children: _jsx(Eye, { className: "h-4 w-4" }) }), _jsx(Button, { size: "sm", variant: "ghost", title: "Baixar PDF (DACTE)", onClick: () => downloadPdf(r), children: _jsx(FileText, { className: "h-4 w-4" }) }), _jsx(Button, { size: "sm", variant: "ghost", title: "Baixar XML", onClick: () => downloadXml(r), children: _jsx(FileDown, { className: "h-4 w-4" }) }), r.sefaz_status.endsWith('_error') && (_jsx(Button, { size: "sm", variant: "ghost", title: "Reenviar \u00E0 SEFAZ", onClick: () => resend.mutate(r.id, {
                                                                        onSuccess: () => toast.success('CT-e marcado para reenvio'),
                                                                        onError: (e) => toast.error(e.message ?? 'Falha ao reenviar'),
                                                                    }), children: _jsx(RefreshCw, { className: "h-4 w-4" }) }))] }) })
                                                ] }, r.id)))] })
                                ] }) })
                    ] }), _jsx(Dialog, { open: !!selected, onOpenChange: (o) => !o && setSelected(null), children: _jsx(DialogContent, { className: "max-w-3xl", children: selected && _jsx(CteDetail, { row: selected, onClose: () => setSelected(null) }) }) })
            ] }) }));
}
function CteDetail({ row, onClose }) {
    const { data: events = [] } = useCteSefazEvents(row.id);
    const cancelCte = useCancelCTe();
    const handleCancel = async () => {
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
    };
    return (_jsxs(_Fragment, { children: [
            _jsxs(DialogHeader, { children: [
                    _jsxs(DialogTitle, { className: "flex items-center gap-2", children: ["CT-e ", row.cte_number ?? '—', " ",
                            _jsx(StatusPill, { status: row.sefaz_status })
                        ] }), _jsxs(DialogDescription, { children: ["Chave: ",
                            _jsx("span", { className: "font-mono", children: row.access_key ?? '—' })
                        ] })
                ] }), _jsxs("div", { className: "flex items-center gap-3 mb-4", children: [(row.sefaz_status === 'processed' || row.sefaz_status === 'processed_error') && (_jsxs(Button, { size: "sm", variant: "outline", onClick: handleCancel, disabled: cancelCte.isPending, children: [
                            _jsx(Ban, { className: "h-4 w-4 mr-2" }),
                            " Cancelar CT-e"] })), row.sefaz_status === 'cancelled' && (_jsx(Badge, { variant: "outline", className: "text-destructive border-destructive/30", children: "Documento Cancelado" })), row.sefaz_status === 'processing' && (_jsx(Badge, { variant: "outline", className: "text-amber-600 border-amber-500/30", children: "Em processamento no Hub..." }))] }), _jsxs("div", { className: "grid grid-cols-2 gap-3 text-sm border-b pb-4 mb-4", children: [
                    _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Emiss\u00E3o:" }),
                            " ", row.issued_at ? new Date(row.issued_at).toLocaleString('pt-BR') : '—'] }), _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Protocolo:" }),
                            " ", row.protocol_number ?? '—'] }), _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Remetente:" }),
                            " ", row.remitter ?? '—'] }), _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Pagador:" }),
                            " ", row.payer_name ?? '—'] }), _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Destinat\u00E1rio:" }),
                            " ", row.recipient ?? '—'] }), _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Cidade/UF Destino:" }),
                            " ", row.recipient_city ?? '—', " / ", row.recipient_state ?? '—'] }), _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Protocolo:" }),
                            " ", row.protocol_number ?? '—'] }), _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Ambiente:" }),
                            " ", row.sefaz_environment ?? '—'] }), _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Placa:" }),
                            " ", row.vehicle_plate ?? '—'] }), _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Motorista:" }),
                            " ", row.driver_name ?? '—'] }), _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Frete:" }),
                            " R$ ", Number(row.freight_value).toFixed(2)] }), _jsxs("div", { children: [
                            _jsx("span", { className: "text-muted-foreground", children: "Carga:" }),
                            " R$ ", Number(row.cargo_value).toFixed(2)] })
                ] }), row.sefaz_status_reason && (_jsxs("div", { className: "rounded border border-destructive/30 bg-destructive/10 p-3 text-sm", children: [
                    _jsxs("p", { className: "font-medium text-destructive flex items-center gap-1", children: [
                            _jsx(AlertCircle, { className: "h-4 w-4" }),
                            " Motivo do erro"] }), _jsx("p", { className: "mt-1", children: row.sefaz_status_reason }), row.sefaz_status_code && _jsxs("p", { className: "text-xs mt-1 text-muted-foreground", children: ["C\u00F3digo: ", row.sefaz_status_code] })] })), _jsxs("div", { children: [
                    _jsx("h3", { className: "font-medium text-sm mb-2", children: "Hist\u00F3rico de eventos SEFAZ" }), _jsxs("div", { className: "border rounded max-h-64 overflow-y-auto divide-y", children: [events.length === 0 && (_jsx("p", { className: "text-xs text-muted-foreground p-3", children: "Nenhum evento registrado ainda. A integra\u00E7\u00E3o fiscal envia os eventos via webhook." })), events.map((e) => (_jsxs("div", { className: "p-2 text-xs", children: [
                                    _jsxs("div", { className: "flex justify-between", children: [
                                            _jsx("span", { className: "font-medium", children: e.event_type }), _jsx("span", { className: "text-muted-foreground", children: new Date(e.occurred_at).toLocaleString('pt-BR') })
                                        ] }), e.reason && _jsx("div", { className: "text-muted-foreground", children: e.reason }), e.protocol_number && _jsxs("div", { className: "text-muted-foreground", children: ["Protocolo: ", e.protocol_number] })] }, e.id)))] })
                ] }), _jsxs("div", { className: "flex justify-end items-center gap-2", children: [row.sefaz_status === 'processed' && row.source === 'hub' && (_jsx(Button, { variant: "destructive", size: "sm", onClick: handleCancel, disabled: cancelCte.isPending, children: cancelCte.isPending ? 'Cancelando...' : 'Cancelar CT-e' })), _jsx("div", { className: "flex-1" }), _jsxs(Button, { variant: "outline", size: "sm", onClick: () => downloadHubFile(row, 'pdf', { view: true }), children: [
                            _jsx(Eye, { className: "h-4 w-4" }),
                            " Visualizar"] }), _jsxs(Button, { variant: "outline", size: "sm", onClick: () => downloadHubFile(row, 'pdf'), children: [
                            _jsx(FileText, { className: "h-4 w-4" }),
                            " PDF"] }), _jsxs(Button, { variant: "outline", size: "sm", onClick: () => downloadHubFile(row, 'xml'), children: [
                            _jsx(FileDown, { className: "h-4 w-4" }),
                            " XML"] }), _jsx(Button, { size: "sm", onClick: onClose, children: "Fechar" })
                ] })
        ] }));
}
