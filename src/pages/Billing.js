import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useBillingDocuments } from '@/hooks/useBillingDocuments';
import { useClients } from '@/hooks/useClients';
import { useLoads, LOAD_STATUSES, LOAD_STATUS_LABELS } from '@/hooks/useLoads';
import { useCteBatches, useCancelCteBatch, useIssuedCtes, useDeleteIssuedCte } from '@/hooks/useBilling';
import { GROUPING_MODES, buildGroups, getGroupingMode } from '@/lib/cteGroupingModes';
import { useUserUiPreference } from '@/hooks/useUserUiPreference';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FileSpreadsheet, Calculator, Layers, FileText, Info, XCircle, Filter, Eraser, Save, ChevronRight, ChevronDown, Trash2, Eye, FileDown } from 'lucide-react';
import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, } from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/sonner';
import { useSortableData } from '@/hooks/useSortableData';
import { format } from 'date-fns';
import { PendingInvoicesBanner } from '@/components/billing/PendingInvoicesBanner';
import { normalizeCity } from '@/lib/utils/normalizeCity';
import { useRecalculateInboundFreight } from '@/hooks/useRecalculateInboundFreight';
import { CteEmissionPreviewDialog } from '@/components/billing/CteEmissionPreviewDialog';
import { CancelCteDialog } from '@/components/billing/CancelCteDialog';
import { OPERATION_TYPE_OPTIONS, } from '@/lib/operationTypeMapping';
const SENTINEL_NONE = '__none__';
const OPERATION_TYPES = OPERATION_TYPE_OPTIONS;
const DEFAULT_BILLING_PREFS = {
    tab: 'period',
    clientId: SENTINEL_NONE,
    supplierId: SENTINEL_NONE,
    periodStart: '',
    periodEnd: '',
    modeId: 1,
    osNumber: '',
    collectOrder: '',
    referenceNumber: '',
    cnpj: '',
    invoiceNumber: '',
    issueDateStart: '',
    issueDateEnd: '',
    importDateStart: '',
    importDateEnd: '',
    supplierManifest: '',
    distributionManifest: '',
    shipmentManifest: '',
    originManifest: '',
    loadStatus: SENTINEL_NONE,
    plate: '',
    scheduledLoadStart: '',
    scheduledLoadEnd: '',
    actualLoadStart: '',
    actualLoadEnd: '',
    supplier: '',
    supplierCnpj: '',
    accessKey: '',
    opTypes: [],
    allOps: true,
};
export default function Billing() {
    const { data: clients = [] } = useClients();
    const { data: loads = [] } = useLoads();
    const { data: batches = [] } = useCteBatches();
    const cancelBatch = useCancelCteBatch();
    const { currentTenant } = useTenant();
    const recalcFreight = useRecalculateInboundFreight();
    // Preferência por tenant (chave isolada por workspace)
    const prefKey = `billing:filters:${currentTenant?.id ?? 'none'}`;
    const { preference, isLoaded, savePreference } = useUserUiPreference(prefKey, DEFAULT_BILLING_PREFS);
    const [tab, setTab] = useState('period');
    const [clientId, setClientId] = useState(SENTINEL_NONE);
    const [supplierId, setSupplierId] = useState(SENTINEL_NONE);
    const [periodStart, setPeriodStart] = useState('');
    const [periodEnd, setPeriodEnd] = useState('');
    const [selectedLoadIds, setSelectedLoadIds] = useState(new Set());
    const [recipientCity, setRecipientCity] = useState(SENTINEL_NONE);
    const [modeId, setModeId] = useState(1);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [modeDialogOpen, setModeDialogOpen] = useState(false);
    const [emitPreviewOpen, setEmitPreviewOpen] = useState(false);
    // ===== Filtros avançados (SIAT) =====
    const [osNumber, setOsNumber] = useState('');
    const [collectOrder, setCollectOrder] = useState('');
    const [referenceNumber, setReferenceNumber] = useState('');
    const [cnpj, setCnpj] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [issueDateStart, setIssueDateStart] = useState('');
    const [issueDateEnd, setIssueDateEnd] = useState('');
    const [importDateStart, setImportDateStart] = useState('');
    const [importDateEnd, setImportDateEnd] = useState('');
    const [supplierManifest, setSupplierManifest] = useState('');
    const [distributionManifest, setDistributionManifest] = useState('');
    const [shipmentManifest, setShipmentManifest] = useState('');
    const [originManifest, setOriginManifest] = useState('');
    const [loadStatus, setLoadStatus] = useState(SENTINEL_NONE);
    const [plate, setPlate] = useState('');
    const [scheduledLoadStart, setScheduledLoadStart] = useState('');
    const [scheduledLoadEnd, setScheduledLoadEnd] = useState('');
    const [actualLoadStart, setActualLoadStart] = useState('');
    const [actualLoadEnd, setActualLoadEnd] = useState('');
    const [supplier, setSupplier] = useState('');
    const [supplierCnpj, setSupplierCnpj] = useState('');
    const [accessKey, setAccessKey] = useState('');
    const [opTypes, setOpTypes] = useState(new Set());
    const [allOps, setAllOps] = useState(true);
    // ===== Pré-filtragem server-side (usa índices criados) =====
    const [onlySpecific, setOnlySpecific] = useState(false);
    const problematicInvoices = ['444798', '444797', '444796', '446083', '446072', '446071', '446070', '446069', '446068', '446067', '446066', '446065', '446064'];
    const { data: docs = [], isLoading: docsLoading } = useBillingDocuments({
        clientId: clientId !== SENTINEL_NONE ? clientId : null,
        supplierId: supplierId !== SENTINEL_NONE ? supplierId : null,
        periodStart: (tab === 'period' && periodStart) ? periodStart : null,
        periodEnd: (tab === 'period' && periodEnd) ? periodEnd : null,
        invoiceNumber: invoiceNumber || null,
        accessKey: accessKey || null,
        remitter: supplier || null,
        referenceNumber: referenceNumber || null,
        recipientCnpj: cnpj || null,
        remitterCnpj: supplierCnpj || null,
        recipientCity: recipientCity !== SENTINEL_NONE ? recipientCity : null,
        onlySpecificInvoices: onlySpecific ? problematicInvoices : null,
    });
    const loadsById = useMemo(() => {
        const m = new Map();
        for (const l of loads)
            m.set(l.id, l);
        return m;
    }, [loads]);
    const { sortedItems: filteredDocs, requestSort, sortConfig } = useSortableData(useMemo(() => {
        return docs.filter(d => {
            if (tab === 'loads') {
                if (!d.load_id || !selectedLoadIds.has(d.load_id))
                    return false;
            }
            // Janela secundária de emissão (independente do tab)
            if (issueDateStart && (!d.issue_date || d.issue_date < issueDateStart))
                return false;
            if (issueDateEnd && (!d.issue_date || d.issue_date > issueDateEnd))
                return false;
            // Janela de data de importação (created_at do documento fiscal)
            if (importDateStart || importDateEnd) {
                const imp = d.created_at ? d.created_at.slice(0, 10) : null;
                if (!imp)
                    return false;
                if (importDateStart && imp < importDateStart)
                    return false;
                if (importDateEnd && imp > importDateEnd)
                    return false;
            }
            // Filtros que dependem da carga associada
            const load = d.load_id ? loadsById.get(d.load_id) : null;
            if (osNumber && !ciIncludes(load?.os_number, osNumber))
                return false;
            if (collectOrder && !ciIncludes(load?.load_number, collectOrder))
                return false;
            if (loadStatus !== SENTINEL_NONE && load?.status !== loadStatus)
                return false;
            if (plate && !ciIncludes(load?.vehicles?.plate, plate))
                return false;
            if (supplierManifest && !ciIncludes(load?.supplier_manifest, supplierManifest))
                return false;
            if (distributionManifest && !ciIncludes(load?.distribution_manifest, distributionManifest))
                return false;
            if (shipmentManifest && !ciIncludes(load?.shipment_manifest, shipmentManifest))
                return false;
            if (originManifest && !ciIncludes(load?.origin_manifest, originManifest))
                return false;
            // Janelas de carregamento (agendado/realizado) — comparam apenas a parte de data
            if (scheduledLoadStart || scheduledLoadEnd) {
                const sch = load?.scheduled_load_at ? load.scheduled_load_at.slice(0, 10) : null;
                if (!sch)
                    return false;
                if (scheduledLoadStart && sch < scheduledLoadStart)
                    return false;
                if (scheduledLoadEnd && sch > scheduledLoadEnd)
                    return false;
            }
            if (actualLoadStart || actualLoadEnd) {
                const act = load?.actual_load_at ? load.actual_load_at.slice(0, 10) : null;
                if (!act)
                    return false;
                if (actualLoadStart && act < actualLoadStart)
                    return false;
                if (actualLoadEnd && act > actualLoadEnd)
                    return false;
            }
            if (!matchesOp(load?.operation_type ?? d.operation_type))
                return false;
            // Cidade do destinatário (já filtrada server-side se selecionada, mas mantida para consistência no client)
            if (recipientCity !== SENTINEL_NONE && normalizeCity(d.recipient_city) !== recipientCity)
                return false;
            return true;
        });
    }, [
        docs, loadsById, tab, selectedLoadIds,
        osNumber, collectOrder,
        issueDateStart, issueDateEnd,
        importDateStart, importDateEnd,
        supplierManifest, distributionManifest,
        shipmentManifest, originManifest, loadStatus, plate,
        scheduledLoadStart, scheduledLoadEnd, actualLoadStart, actualLoadEnd,
        opTypes, allOps, recipientCity,
    ]));
    const [selectedDocIds, setSelectedDocIds] = useState(new Set());
    // ===== Hidrata estado a partir da preferência salva (uma única vez) =====
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (!isLoaded || hydratedRef.current || !preference)
            return;
        hydratedRef.current = true;
        const p = preference;
        setTab(p.tab ?? 'period');
        setClientId(p.clientId ?? SENTINEL_NONE);
        setSupplierId(p.supplierId ?? SENTINEL_NONE);
        setPeriodStart(p.periodStart ?? '');
        setPeriodEnd(p.periodEnd ?? '');
        setModeId(p.modeId ?? 1);
        setOsNumber(p.osNumber ?? '');
        setCollectOrder(p.collectOrder ?? '');
        setReferenceNumber(p.referenceNumber ?? '');
        setCnpj(p.cnpj ?? '');
        setInvoiceNumber(p.invoiceNumber ?? '');
        setIssueDateStart(p.issueDateStart ?? '');
        setIssueDateEnd(p.issueDateEnd ?? '');
        setImportDateStart(p.importDateStart ?? '');
        setImportDateEnd(p.importDateEnd ?? '');
        setSupplierManifest(p.supplierManifest ?? '');
        setDistributionManifest(p.distributionManifest ?? '');
        setShipmentManifest(p.shipmentManifest ?? '');
        setOriginManifest(p.originManifest ?? '');
        setLoadStatus(p.loadStatus ?? SENTINEL_NONE);
        setPlate(p.plate ?? '');
        setScheduledLoadStart(p.scheduledLoadStart ?? '');
        setScheduledLoadEnd(p.scheduledLoadEnd ?? '');
        setActualLoadStart(p.actualLoadStart ?? '');
        setActualLoadEnd(p.actualLoadEnd ?? '');
        setSupplier(p.supplier ?? '');
        setSupplierCnpj(p.supplierCnpj ?? '');
        setAccessKey(p.accessKey ?? '');
        setOpTypes(new Set(p.opTypes ?? []));
        setAllOps(p.allOps ?? true);
    }, [isLoaded, preference]);
    // ===== Auto-save (debounced) sempre que estado muda =====
    useEffect(() => {
        if (!isLoaded || !hydratedRef.current)
            return;
        const t = setTimeout(() => {
            savePreference({
                tab,
                clientId,
                supplierId,
                periodStart,
                periodEnd,
                modeId,
                osNumber,
                collectOrder,
                referenceNumber,
                cnpj,
                invoiceNumber,
                issueDateStart,
                issueDateEnd,
                importDateStart,
                importDateEnd,
                supplierManifest,
                distributionManifest,
                shipmentManifest,
                originManifest,
                loadStatus,
                plate,
                scheduledLoadStart,
                scheduledLoadEnd,
                actualLoadStart,
                actualLoadEnd,
                supplier,
                supplierCnpj,
                accessKey,
                opTypes: Array.from(opTypes),
                allOps,
            });
        }, 600);
        return () => clearTimeout(t);
    }, [
        isLoaded, savePreference,
        tab, clientId, supplierId, periodStart, periodEnd, modeId,
        osNumber, collectOrder, referenceNumber, cnpj, invoiceNumber,
        issueDateStart, issueDateEnd,
        importDateStart, importDateEnd,
        supplierManifest, distributionManifest, shipmentManifest, originManifest,
        loadStatus, plate,
        scheduledLoadStart, scheduledLoadEnd, actualLoadStart, actualLoadEnd,
        supplier, supplierCnpj, accessKey,
        opTypes, allOps,
    ]);
    const toggleOp = (op) => {
        setAllOps(false);
        setOpTypes(prev => {
            const next = new Set(prev);
            next.has(op) ? next.delete(op) : next.add(op);
            return next;
        });
    };
    const clearAdvanced = () => {
        setOsNumber('');
        setCollectOrder('');
        setReferenceNumber('');
        setCnpj('');
        setInvoiceNumber('');
        setIssueDateStart('');
        setIssueDateEnd('');
        setImportDateStart('');
        setImportDateEnd('');
        setSupplierManifest('');
        setDistributionManifest('');
        setShipmentManifest('');
        setOriginManifest('');
        setLoadStatus(SENTINEL_NONE);
        setPlate('');
        setScheduledLoadStart('');
        setScheduledLoadEnd('');
        setActualLoadStart('');
        setActualLoadEnd('');
        setSupplier('');
        setSupplierCnpj('');
        setAccessKey('');
        setOpTypes(new Set());
        setAllOps(true);
    };
    const matchesOp = (opType) => {
        if (allOps || opTypes.size === 0)
            return true;
        return opType ? opTypes.has(opType) : false;
    };
    const ciIncludes = (haystack, needle) => !needle || (haystack || '').toLowerCase().includes(needle.toLowerCase());
    // Cidades de destino disponíveis nas notas elegíveis (chave normalizada -> rótulo exibido)
    const recipientCityOptions = useMemo(() => {
        const m = new Map();
        for (const d of docs) {
            const key = normalizeCity(d.recipient_city);
            if (!key)
                continue;
            const label = `${d.recipient_city}${d.recipient_state ? `/${d.recipient_state}` : ''}`;
            const cur = m.get(key);
            if (cur)
                cur.count += 1;
            else
                m.set(key, { key, label, count: 1 });
        }
        return Array.from(m.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    }, [docs]);
    // Se o operador marcou notas específicas, restringe a elas. Caso contrário,
    // usa todas as notas resultantes dos filtros (comportamento por lote antigo).
    const eligibleDocs = useMemo(() => {
        if (selectedDocIds.size === 0)
            return filteredDocs;
        return filteredDocs.filter(d => selectedDocIds.has(d.id));
    }, [filteredDocs, selectedDocIds]);
    // Limpa seleções que deixaram de fazer parte do universo filtrado.
    useEffect(() => {
        if (selectedDocIds.size === 0 || docsLoading)
            return;
        const valid = new Set(filteredDocs.map(d => d.id));
        let changed = false;
        const next = new Set();
        selectedDocIds.forEach(id => {
            if (valid.has(id))
                next.add(id);
            else
                changed = true;
        });
        if (changed)
            setSelectedDocIds(next);
    }, [filteredDocs, docsLoading]);
    const toggleDoc = (id) => {
        setSelectedDocIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };
    const selectAllDocs = () => setSelectedDocIds(new Set(filteredDocs.map(d => d.id)));
    const clearDocSelection = () => setSelectedDocIds(new Set());
    const groups = useMemo(() => buildGroups(eligibleDocs, modeId), [eligibleDocs, modeId]);
    const totals = useMemo(() => ({
        docs: eligibleDocs.length,
        cargo: eligibleDocs.reduce((s, d) => s + (Number(d.value) || 0), 0),
        freight: eligibleDocs.reduce((s, d) => s + (Number(d.freight_value) || 0), 0),
        pallets: eligibleDocs.reduce((s, d) => s + (d.pallet_count || 0), 0),
        weight: eligibleDocs.reduce((s, d) => s + (Number(d.weight_kg) || 0), 0),
    }), [eligibleDocs]);
    const billableLoads = useMemo(() => loads.filter(l => clientId === SENTINEL_NONE ? true : docs.some(d => d.load_id === l.id && d.client_id === clientId)), [loads, docs, clientId]);
    const toggleLoad = (id) => {
        setSelectedLoadIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };
    const mode = getGroupingMode(modeId);
    const activeFilterCount = [
        osNumber, collectOrder, referenceNumber, cnpj, invoiceNumber,
        issueDateStart, issueDateEnd, supplierManifest, distributionManifest,
        shipmentManifest, originManifest, plate, scheduledLoadStart, scheduledLoadEnd,
        actualLoadStart, actualLoadEnd, supplier, supplierCnpj, accessKey,
        importDateStart, importDateEnd,
    ].filter(Boolean).length
        + (loadStatus !== SENTINEL_NONE ? 1 : 0)
        + (!allOps && opTypes.size > 0 ? 1 : 0);
    return (_jsxs("div", { className: "animate-fade-in space-y-6", children: [
            _jsx(PendingInvoicesBanner, { from: "billing" }), _jsx("div", { className: "flex items-center justify-between", children: _jsxs("div", { children: [
                        _jsxs("h1", { className: "text-2xl font-bold text-foreground flex items-center gap-2", children: [
                                _jsx(FileSpreadsheet, { className: "h-6 w-6 text-primary" }),
                                " Faturamento (CT-e / Conhecimento)"] }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Gere conhecimentos de transporte agrupando notas pelos 14 modos dispon\u00EDveis. Os CT-es alimentam Contas a Receber automaticamente." })
                    ] }) }), _jsxs(Card, { children: [
                    _jsx(CardHeader, { children: _jsx(CardTitle, { className: "text-base", children: "1. Selecione a base de faturamento" }) }), _jsx(CardContent, { className: "space-y-4", children: _jsxs(Tabs, { value: tab, onValueChange: (v) => {
                                const next = v;
                                setTab(next);
                                if (next === 'period')
                                    setClientId(SENTINEL_NONE);
                                if (next === 'loads')
                                    setSupplierId(SENTINEL_NONE);
                            }, children: [
                                _jsxs(TabsList, { children: [
                                        _jsx(TabsTrigger, { value: "period", children: "Por fornecedor / per\u00EDodo" }), _jsx(TabsTrigger, { value: "loads", children: "Por cargas" })
                                    ] }), _jsx(TabsContent, { value: "period", className: "space-y-3 pt-3", children: _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-4 gap-3", children: [
                                            _jsxs("div", { className: "md:col-span-2", children: [
                                                    _jsx(Label, { children: "Fornecedor" }), _jsxs(Select, { value: supplierId, onValueChange: setSupplierId, children: [
                                                            _jsx(SelectTrigger, { children: _jsx(SelectValue, { placeholder: "Selecione um fornecedor" }) }), _jsxs(SelectContent, { children: [
                                                                    _jsx(SelectItem, { value: SENTINEL_NONE, children: "Todos os fornecedores" }), clients.filter(c => c.is_supplier).map(c => (_jsxs(SelectItem, { value: c.id, children: [c.company_name, c.tax_id ? ` — ${c.tax_id}` : ''] }, c.id)))] })
                                                        ] }), _jsxs("p", { className: "mt-1 text-xs text-muted-foreground", children: ["V\u00EDnculo direto pelo CNPJ do remetente da NF-e. Cadastre fornecedores em ",
                                                            _jsx("span", { className: "font-medium", children: "Clientes e Fornecedores" }),
                                                            "."] })
                                                ] }), _jsxs("div", { className: "md:col-span-2 grid grid-cols-2 gap-2", children: [
                                                    _jsxs("div", { children: [
                                                            _jsx(Label, { children: "In\u00EDcio" }), _jsx(Input, { type: "date", value: periodStart, onChange: e => setPeriodStart(e.target.value) })
                                                        ] }), _jsxs("div", { children: [
                                                            _jsx(Label, { children: "Fim" }), _jsx(Input, { type: "date", value: periodEnd, onChange: e => setPeriodEnd(e.target.value) })
                                                        ] })
                                                ] })
                                        ] }) }), _jsxs(TabsContent, { value: "loads", className: "space-y-3 pt-3", children: [
                                        _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-3", children: _jsxs("div", { children: [
                                                    _jsx(Label, { children: "Cliente (opcional)" }), _jsxs(Select, { value: clientId, onValueChange: setClientId, children: [
                                                            _jsx(SelectTrigger, { children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [
                                                                    _jsx(SelectItem, { value: SENTINEL_NONE, children: "Todos os clientes" }), clients.map(c => _jsx(SelectItem, { value: c.id, children: c.company_name }, c.id))] })
                                                        ] })
                                                ] }) }), _jsx("div", { className: "rounded-md border max-h-72 overflow-y-auto", children: _jsxs(Table, { children: [
                                                    _jsx(TableHeader, { children: _jsxs(TableRow, { children: [
                                                                _jsx(TableHead, { className: "w-10" }), _jsx(TableHead, { children: "Carga" }), _jsx(TableHead, { children: "Origem \u2192 Destino" }), _jsx(TableHead, { className: "text-right", children: "Pallets" }), _jsx(TableHead, { className: "text-right", children: "Peso (kg)" })
                                                            ] }) }), _jsx(TableBody, { children: billableLoads.length === 0 ? (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 5, className: "text-center text-muted-foreground py-6", children: "Nenhuma carga dispon\u00EDvel" }) })) : billableLoads.map(l => (_jsxs(TableRow, { className: "cursor-pointer", onClick: () => toggleLoad(l.id), children: [
                                                                _jsx(TableCell, { children: _jsx(Checkbox, { checked: selectedLoadIds.has(l.id) }) }), _jsx(TableCell, { className: "font-mono text-sm", children: l.load_number }), _jsxs(TableCell, { className: "text-sm", children: [l.origin || '—', " \u2192 ", l.destination || '—'] }), _jsx(TableCell, { className: "text-right text-sm", children: l.total_pallet_count || 0 }), _jsx(TableCell, { className: "text-right text-sm", children: Number(l.total_weight_kg || 0).toLocaleString('pt-BR') })
                                                            ] }, l.id))) })
                                                ] }) })
                                    ] })
                            ] }) })
                ] }), _jsxs(Card, { children: [
                    _jsxs(CardHeader, { className: "flex-row items-center justify-between space-y-0", children: [
                            _jsxs(CardTitle, { className: "text-base flex items-center gap-2", children: [
                                    _jsx(Filter, { className: "h-4 w-4 text-primary" }),
                                    " Filtros avan\u00E7ados (gera\u00E7\u00E3o autom\u00E1tica)", activeFilterCount > 0 && (_jsxs(Badge, { variant: "outline", className: "ml-2 bg-primary/10 text-primary border-primary/30", children: [activeFilterCount, " ativo", activeFilterCount > 1 ? 's' : ''] }))] }), _jsxs("div", { className: "flex items-center gap-2", children: [
                                    _jsxs("span", { className: "hidden md:inline-flex items-center gap-1 text-xs text-muted-foreground", children: [
                                            _jsx(Save, { className: "h-3 w-3" }),
                                            " Prefer\u00EAncias salvas automaticamente"] }), _jsxs(Button, { variant: "ghost", size: "sm", onClick: clearAdvanced, disabled: activeFilterCount === 0, children: [
                                            _jsx(Eraser, { className: "h-4 w-4 mr-1" }),
                                            " Limpar"] })
                                ] })
                        ] }), _jsxs(CardContent, { className: "space-y-5", children: [
                            _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3", children: [
                                    _jsx(Field, { label: "Remetente", children: _jsx(Input, { value: supplier, onChange: e => setSupplier(e.target.value) }) }), _jsx(Field, { label: "Cliente", children: _jsx(Input, { value: cnpj, onChange: e => setCnpj(e.target.value), placeholder: "00.000.000/0000-00" }) }), _jsx(Field, { label: "Munic\u00EDpio", children: _jsxs("select", { className: "h-10 rounded-md border bg-background px-3 text-sm", value: recipientCity, onChange: e => setRecipientCity(e.target.value), children: [
                                                _jsx("option", { value: SENTINEL_NONE, children: "Todos os munic\u00EDpios" }), recipientCityOptions.map(opt => (_jsxs("option", { value: opt.key, children: [opt.label, " (", opt.count, ")"] }, opt.key)))] }) }), _jsx(Field, { label: "Fornecedor", children: _jsx(Input, { value: supplierCnpj, onChange: e => setSupplierCnpj(e.target.value), placeholder: "CNPJ do fornecedor" }) }), _jsx(Field, { label: "N\u00BA OS", children: _jsx(Input, { value: osNumber, onChange: e => setOsNumber(e.target.value) }) }), _jsx(Field, { label: "Ordem de Coleta", children: _jsx(Input, { value: collectOrder, onChange: e => setCollectOrder(e.target.value) }) }), _jsx(Field, { label: "N\u00BA Refer\u00EAncia", children: _jsx(Input, { value: referenceNumber, onChange: e => setReferenceNumber(e.target.value) }) }), _jsx(Field, { label: "Nota Fiscal", children: _jsx(Input, { value: invoiceNumber, onChange: e => setInvoiceNumber(e.target.value) }) }), _jsx(Field, { label: "Emiss\u00E3o NF \u2014 In\u00EDcio", children: _jsx(Input, { type: "date", value: issueDateStart, onChange: e => setIssueDateStart(e.target.value) }) }), _jsx(Field, { label: "Emiss\u00E3o NF \u2014 Fim", children: _jsx(Input, { type: "date", value: issueDateEnd, onChange: e => setIssueDateEnd(e.target.value) }) }), _jsx(Field, { label: "Chave Acesso CT-e", children: _jsx(Input, { value: accessKey, onChange: e => setAccessKey(e.target.value), placeholder: "44 d\u00EDgitos" }) }), _jsx(Field, { label: "Importa\u00E7\u00E3o \u2014 In\u00EDcio", children: _jsx(Input, { type: "date", value: importDateStart, onChange: e => setImportDateStart(e.target.value) }) }), _jsx(Field, { label: "Importa\u00E7\u00E3o \u2014 Fim", children: _jsx(Input, { type: "date", value: importDateEnd, onChange: e => setImportDateEnd(e.target.value) }) }), _jsx(Field, { label: "Romaneio do Fornecedor", children: _jsx(Input, { value: supplierManifest, onChange: e => setSupplierManifest(e.target.value) }) }), _jsx(Field, { label: "Romaneio de Distribui\u00E7\u00E3o", children: _jsx(Input, { value: distributionManifest, onChange: e => setDistributionManifest(e.target.value) }) }), _jsx(Field, { label: "Romaneio de Expedi\u00E7\u00E3o", children: _jsx(Input, { value: shipmentManifest, onChange: e => setShipmentManifest(e.target.value) }) }), _jsx(Field, { label: "Romaneio Origem", children: _jsx(Input, { value: originManifest, onChange: e => setOriginManifest(e.target.value) }) }), _jsx(Field, { label: "Status da Carga", children: _jsxs(Select, { value: loadStatus, onValueChange: setLoadStatus, children: [
                                                _jsx(SelectTrigger, { children: _jsx(SelectValue, { placeholder: "Todos" }) }), _jsxs(SelectContent, { children: [
                                                        _jsx(SelectItem, { value: SENTINEL_NONE, children: "Todos" }), LOAD_STATUSES.map(s => (_jsx(SelectItem, { value: s, children: LOAD_STATUS_LABELS[s] }, s)))] })
                                            ] }) }), _jsx(Field, { label: "Placa", children: _jsx(Input, { value: plate, onChange: e => setPlate(e.target.value.toUpperCase()), placeholder: "ABC1D23" }) }), _jsx(Field, { label: "Identifica\u00E7\u00E3o Remetente", children: _jsx(Input, { value: supplier, onChange: e => setSupplier(e.target.value) }) }), _jsx(Field, { label: "Identifica\u00E7\u00E3o Fornecedor", children: _jsx(Input, { value: supplierCnpj, onChange: e => setSupplierCnpj(e.target.value) }) }), _jsx(Field, { label: "Carregamento Previsto \u2014 In\u00EDcio", children: _jsx(Input, { type: "date", value: scheduledLoadStart, onChange: e => setScheduledLoadStart(e.target.value) }) }), _jsx(Field, { label: "Carregamento Previsto \u2014 Fim", children: _jsx(Input, { type: "date", value: scheduledLoadEnd, onChange: e => setScheduledLoadEnd(e.target.value) }) }), _jsx(Field, { label: "Carregamento Real \u2014 In\u00EDcio", children: _jsx(Input, { type: "date", value: actualLoadStart, onChange: e => setActualLoadStart(e.target.value) }) }), _jsx(Field, { label: "Carregamento Real \u2014 Fim", children: _jsx(Input, { type: "date", value: actualLoadEnd, onChange: e => setActualLoadEnd(e.target.value) }) })
                                ] }), _jsxs("div", { children: [
                                    _jsx(Label, { className: "text-xs text-muted-foreground", children: "Tipos de opera\u00E7\u00E3o" }), _jsxs("div", { className: "mt-2 flex flex-wrap gap-3", children: [
                                            _jsxs("label", { className: "flex items-center gap-2 text-sm cursor-pointer", children: [
                                                    _jsx(Checkbox, { checked: allOps, onCheckedChange: (v) => { setAllOps(!!v); if (v)
                                                            setOpTypes(new Set()); } }), _jsx("span", { className: "font-medium", children: "Todos" })
                                                ] }), OPERATION_TYPES.map(op => (_jsxs("label", { className: "flex items-center gap-2 text-sm cursor-pointer", children: [
                                                    _jsx(Checkbox, { checked: !allOps && opTypes.has(op.value), onCheckedChange: () => toggleOp(op.value) }), _jsx("span", { children: op.label })
                                                ] }, op.value)))] })
                                ] })
                        ] })
                ] }), _jsxs(Card, { children: [
                    _jsxs(CardHeader, { className: "flex-row items-center justify-between space-y-0", children: [
                            _jsxs(CardTitle, { className: "text-base flex items-center gap-2", children: [
                                    _jsx(FileText, { className: "h-4 w-4 text-primary" }),
                                    " 2. Selecionar notas",
                                    _jsx(Badge, { variant: "outline", className: "ml-2", children: selectedDocIds.size > 0
                                            ? `${selectedDocIds.size} selecionada${selectedDocIds.size > 1 ? 's' : ''}`
                                            : `${filteredDocs.length} elegíveis` })
                                ] }), _jsxs("div", { className: "flex items-center gap-2", children: [
                                    _jsx(Button, { variant: "ghost", size: "sm", onClick: selectAllDocs, disabled: filteredDocs.length === 0, children: "Selecionar todas" }), _jsxs(Button, { variant: "ghost", size: "sm", onClick: clearDocSelection, disabled: selectedDocIds.size === 0, children: [
                                            _jsx(Eraser, { className: "h-4 w-4 mr-1" }),
                                            " Limpar sele\u00E7\u00E3o"] }), _jsx(Button, { variant: onlySpecific ? "default" : "outline", size: "sm", onClick: () => setOnlySpecific(!onlySpecific), className: onlySpecific ? "bg-amber-600 hover:bg-amber-700" : "", children: onlySpecific ? "Mostrando 13" : "Isolar as 13" }), _jsxs(Button, { variant: "outline", size: "sm", disabled: filteredDocs.length === 0, onClick: () => {
                                            const docsToExport = selectedDocIds.size > 0
                                                ? filteredDocs.filter(d => selectedDocIds.has(d.id))
                                                : filteredDocs;
                                            const escape = (str) => {
                                                if (str === null || str === undefined)
                                                    return '';
                                                return String(str)
                                                    .replace(/&/g, '&amp;')
                                                    .replace(/</g, '&lt;')
                                                    .replace(/>/g, '&gt;')
                                                    .replace(/"/g, '&quot;')
                                                    .replace(/'/g, '&apos;');
                                            };
                                            const formatDate = (date) => {
                                                if (!date)
                                                    return '';
                                                try {
                                                    return format(new Date(date), 'dd/MM/yyyy');
                                                }
                                                catch {
                                                    return date;
                                                }
                                            };
                                            let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Notas>\n';
                                            docsToExport.forEach(d => {
                                                xml += '  <Nota>\n';
                                                xml += `    <NF>${escape(d.invoice_number)}</NF>\n`;
                                                xml += `    <Emissao>${escape(formatDate(d.issue_date))}</Emissao>\n`;
                                                xml += `    <Remetente>${escape(d.remitter)}</Remetente>\n`;
                                                xml += `    <Destinatario>${escape(d.recipient || d.clients?.company_name)}</Destinatario>\n`;
                                                xml += `    <CidadeDestino>${escape(d.recipient_city)}${d.recipient_state ? `/${escape(d.recipient_state)}` : ''}</CidadeDestino>\n`;
                                                xml += `    <Pallets>${escape(d.pallet_count)}</Pallets>\n`;
                                                xml += `    <Peso>${escape(Number(d.weight_kg || 0).toLocaleString('pt-BR'))}</Peso>\n`;
                                                xml += `    <Valor>${escape(Number(d.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))}</Valor>\n`;
                                                xml += `    <Frete>${escape(d.freight_value ? Number(d.freight_value).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '')}</Frete>\n`;
                                                xml += '  </Nota>\n';
                                            });
                                            xml += '</Notas>';
                                            const blob = new Blob([xml], { type: 'application/xml' });
                                            const url = URL.createObjectURL(blob);
                                            const link = document.createElement('a');
                                            link.href = url;
                                            link.download = `notas_faturamento_${format(new Date(), 'yyyyMMdd_HHmm')}.xml`;
                                            document.body.appendChild(link);
                                            link.click();
                                            document.body.removeChild(link);
                                            URL.revokeObjectURL(url);
                                            toast.success('XML exportado com sucesso');
                                        }, children: [
                                            _jsx(FileDown, { className: "h-4 w-4 mr-1" }),
                                            " Exportar XML"] }), _jsxs(Button, { variant: "outline", size: "sm", disabled: filteredDocs.length === 0 || recalcFreight.isPending, onClick: async () => {
                                            const ids = (selectedDocIds.size > 0
                                                ? filteredDocs.filter(d => selectedDocIds.has(d.id))
                                                : filteredDocs).map(d => d.id);
                                            if (ids.length === 0)
                                                return;
                                            const r = await recalcFreight.mutateAsync(ids);
                                            toast.success(`Fretes recalculados: ${r.updated} atualizadas, ${r.skipped} ignoradas, ${r.failed} falhas`);
                                        }, children: [
                                            _jsx(Calculator, { className: "h-4 w-4 mr-1" }), recalcFreight.isPending ? 'Recalculando…' : 'Recalcular fretes'] })
                                ] })
                        ] }), _jsxs(CardContent, { className: "p-0", children: [
                            _jsxs("div", { className: "px-6 pb-3 flex flex-wrap items-end gap-3", children: [
                                    _jsxs("div", { className: "flex flex-col gap-1 min-w-[240px]", children: [
                                            _jsx(Label, { className: "text-xs text-muted-foreground", children: "Cidade do destinat\u00E1rio" }), _jsxs(Select, { value: recipientCity, onValueChange: setRecipientCity, children: [
                                                    _jsx(SelectTrigger, { children: _jsx(SelectValue, { placeholder: "Todas as cidades" }) }), _jsxs(SelectContent, { children: [
                                                            _jsx(SelectItem, { value: SENTINEL_NONE, children: "Todas as cidades" }), recipientCityOptions.map(c => (_jsxs(SelectItem, { value: c.key, children: [c.label, " (", c.count, ")"] }, c.key)))] })
                                                ] })
                                        ] }), recipientCity !== SENTINEL_NONE && (_jsxs(Button, { variant: "ghost", size: "sm", onClick: () => setRecipientCity(SENTINEL_NONE), children: [
                                            _jsx(Eraser, { className: "h-4 w-4 mr-1" }),
                                            " Limpar cidade"] }))] }), _jsxs("p", { className: "px-6 pb-3 text-xs text-muted-foreground", children: ["Se nenhuma nota estiver marcada, todas as ", filteredDocs.length, " notas filtradas ser\u00E3o faturadas (modo lote). Marque notas espec\u00EDficas para gerar apenas os CT-es correspondentes."] }), _jsx("div", { className: "max-h-96 overflow-y-auto border-t", children: _jsxs(Table, { children: [
                                        _jsx(TableHeader, { className: "sticky top-0 bg-background", children: _jsxs(TableRow, { children: [
                                                    _jsx(TableHead, { className: "w-10", children: _jsx(Checkbox, { checked: filteredDocs.length > 0 && selectedDocIds.size === filteredDocs.length, onCheckedChange: (v) => v ? selectAllDocs() : clearDocSelection() }) }), _jsx(TableHead, { sortKey: "invoice_number", sortConfig: sortConfig, onSort: requestSort, children: "NF" }), _jsx(TableHead, { sortKey: "issue_date", sortConfig: sortConfig, onSort: requestSort, children: "Emiss\u00E3o" }), _jsx(TableHead, { sortKey: "remitter", sortConfig: sortConfig, onSort: requestSort, children: "Remetente" }), _jsx(TableHead, { sortKey: "recipient", sortConfig: sortConfig, onSort: requestSort, children: "Destinat\u00E1rio" }), _jsx(TableHead, { sortKey: "recipient_city", sortConfig: sortConfig, onSort: requestSort, children: "Cidade destino" }), _jsx(TableHead, { className: "text-right", sortKey: "pallet_count", sortConfig: sortConfig, onSort: requestSort, children: "Pallets" }), _jsx(TableHead, { className: "text-right", sortKey: "weight_kg", sortConfig: sortConfig, onSort: requestSort, children: "Peso" }), _jsx(TableHead, { className: "text-right", sortKey: "value", sortConfig: sortConfig, onSort: requestSort, children: "Valor" }), _jsx(TableHead, { className: "text-right", sortKey: "freight_value", sortConfig: sortConfig, onSort: requestSort, children: "Frete" })
                                                ] }) }), _jsx(TableBody, { children: docsLoading ? (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 10, className: "text-center text-muted-foreground py-6", children: "Carregando..." }) })) : filteredDocs.length === 0 ? (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 10, className: "text-center text-muted-foreground py-6", children: "Nenhuma nota dispon\u00EDvel com os filtros atuais." }) })) : filteredDocs.map(d => (_jsxs(TableRow, { className: "cursor-pointer", onClick: () => toggleDoc(d.id), children: [
                                                    _jsx(TableCell, { children: _jsx(Checkbox, { checked: selectedDocIds.has(d.id) }) }), _jsx(TableCell, { className: "font-mono text-xs", children: d.invoice_number || '—' }), _jsx(TableCell, { className: "text-sm", children: d.issue_date ? format(new Date(d.issue_date), 'dd/MM/yyyy') : '—' }), _jsx(TableCell, { className: "text-sm truncate max-w-[220px]", children: d.remitter || '—' }), _jsx(TableCell, { className: "text-sm truncate max-w-[220px]", children: d.recipient || d.clients?.company_name || '—' }), _jsx(TableCell, { className: "text-sm", children: d.recipient_city
                                                            ? `${d.recipient_city}${d.recipient_state ? `/${d.recipient_state}` : ''}`
                                                            : '—' }), _jsx(TableCell, { className: "text-right text-sm", children: d.pallet_count || 0 }), _jsx(TableCell, { className: "text-right text-sm", children: Number(d.weight_kg || 0).toLocaleString('pt-BR') }), _jsxs(TableCell, { className: "text-right text-sm", children: ["R$ ", Number(d.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })] }), _jsx(TableCell, { className: "text-right text-sm", children: d.freight_value
                                                            ? `R$ ${Number(d.freight_value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                                                            : _jsx("span", { className: "text-muted-foreground", children: "\u2014" }) })
                                                ] }, d.id))) })
                                    ] }) })
                        ] })
                ] }), _jsxs(Card, { children: [
                    _jsx(CardHeader, { children: _jsxs(CardTitle, { className: "text-base flex items-center gap-2", children: [
                                _jsx(Layers, { className: "h-4 w-4 text-primary" }),
                                " 3. Modo de gera\u00E7\u00E3o do conhecimento"] }) }), _jsx(CardContent, { children: _jsxs("div", { className: "flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 p-3", children: [
                                _jsxs("div", { className: "flex items-start gap-3 min-w-0", children: [
                                        _jsxs(Badge, { variant: "outline", className: "font-mono shrink-0", children: ["#", String(mode.id).padStart(2, '0')] }), _jsxs("div", { className: "min-w-0", children: [
                                                _jsx("p", { className: "text-sm font-medium text-foreground", children: mode.label }), _jsx("p", { className: "text-xs text-muted-foreground line-clamp-1", children: mode.description })
                                            ] })
                                    ] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setModeDialogOpen(true), children: "Alterar modo" })
                            ] }) })
                ] }), _jsxs(Card, { children: [
                    _jsx(CardHeader, { children: _jsxs(CardTitle, { className: "text-base flex items-center gap-2", children: [
                                _jsx(Calculator, { className: "h-4 w-4 text-primary" }),
                                " 4. Pr\u00E9via do faturamento"] }) }), _jsxs(CardContent, { className: "space-y-4", children: [
                            _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-5 gap-3", children: [
                                    _jsx(Stat, { label: "Notas eleg\u00EDveis", value: totals.docs }), _jsx(Stat, { label: "CT-es a gerar", value: groups.length, highlight: true }), _jsx(Stat, { label: "Valor da carga", value: `R$ ${totals.cargo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` }), _jsx(Stat, { label: "Frete total", value: `R$ ${totals.freight.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` }), _jsx(Stat, { label: "Peso (kg)", value: totals.weight.toLocaleString('pt-BR') })
                                ] }), _jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [
                                    _jsx(Info, { className: "h-3.5 w-3.5" }),
                                    "Modo selecionado: ",
                                    _jsx("strong", { className: "text-foreground", children: mode.label })
                                ] }), _jsxs("div", { className: "flex justify-end gap-2", children: [
                                    _jsxs(Button, { variant: "ghost", disabled: groups.length === 0, onClick: () => setPreviewOpen(true), children: ["Ver pr\u00E9via (", groups.length, ")"] }), _jsxs(Button, { disabled: groups.length === 0, onClick: () => setEmitPreviewOpen(true), children: ["Pr\u00E9via edit\u00E1vel & transmitir (", groups.length, ")"] })
                                ] })
                        ] })
                ] }), _jsxs(Card, { children: [
                    _jsx(CardHeader, { children: _jsxs(CardTitle, { className: "text-base flex items-center gap-2", children: [
                                _jsx(FileText, { className: "h-4 w-4 text-primary" }),
                                " CT-es transmitidos & notas vinculadas"] }) }), _jsx(CardContent, { className: "p-0", children: _jsx(IssuedCtesTable, {}) })
                ] }), _jsxs(Card, { children: [
                    _jsx(CardHeader, { children: _jsxs(CardTitle, { className: "text-base flex items-center gap-2", children: [
                                _jsx(FileText, { className: "h-4 w-4 text-primary" }),
                                " Lotes gerados"] }) }), _jsx(CardContent, { className: "p-0", children: _jsxs(Table, { children: [
                                _jsx(TableHeader, { children: _jsxs(TableRow, { children: [
                                            _jsx(TableHead, { children: "Data" }), _jsx(TableHead, { children: "Cliente" }), _jsx(TableHead, { children: "Modo" }), _jsx(TableHead, { className: "text-right", children: "CT-es" }), _jsx(TableHead, { className: "text-right", children: "Frete" }), _jsx(TableHead, { children: "Status" }), _jsx(TableHead, {})
                                        ] }) }), _jsx(TableBody, { children: docsLoading ? (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 7, className: "text-center text-muted-foreground py-8", children: "Carregando..." }) })) : batches.length === 0 ? (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 7, className: "text-center text-muted-foreground py-8", children: "Nenhum lote gerado ainda" }) })) : batches.map(b => (_jsxs(TableRow, { children: [
                                            _jsx(TableCell, { className: "text-sm", children: format(new Date(b.created_at), 'dd/MM/yyyy HH:mm') }), _jsx(TableCell, { className: "text-sm", children: b.clients?.company_name || '—' }), _jsxs(TableCell, { className: "text-sm", children: [
                                                    _jsxs(Badge, { variant: "outline", className: "font-mono", children: ["#", String(b.grouping_mode).padStart(2, '0')] }), ' ', _jsx("span", { className: "text-muted-foreground text-xs", children: b.grouping_mode_label })
                                                ] }), _jsx(TableCell, { className: "text-right font-medium", children: b.total_documents }), _jsxs(TableCell, { className: "text-right", children: ["R$ ", Number(b.total_freight).toLocaleString('pt-BR', { minimumFractionDigits: 2 })] }), _jsx(TableCell, { children: _jsx(Badge, { variant: "outline", className: b.status === 'generated' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                                                        b.status === 'cancelled' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                                                            'bg-amber-500/10 text-amber-600 border-amber-500/20', children: b.status === 'generated'
                                                        ? 'Rascunho local (não transmitido)'
                                                        : b.status === 'cancelled'
                                                            ? 'Cancelado'
                                                            : 'Rascunho' }) }), _jsx(TableCell, { className: "text-right", children: b.status !== 'cancelled' && (_jsxs(Button, { variant: "ghost", size: "sm", onClick: () => cancelBatch.mutate(b.id), children: [
                                                        _jsx(XCircle, { className: "h-4 w-4 mr-1" }),
                                                        " Cancelar"] })) })
                                        ] }, b.id))) })
                            ] }) })
                ] }), _jsx(Dialog, { open: previewOpen, onOpenChange: setPreviewOpen, children: _jsxs(DialogContent, { className: "max-w-4xl", children: [
                        _jsx(DialogHeader, { children: _jsx(DialogTitle, { children: "Pr\u00E9via dos CT-es a gerar" }) }), _jsx("div", { className: "max-h-[60vh] overflow-auto rounded-md border", children: _jsxs(Table, { children: [
                                    _jsx(TableHeader, { children: _jsxs(TableRow, { children: [
                                                _jsx(TableHead, { children: "#" }), _jsx(TableHead, { children: "Remetente" }), _jsx(TableHead, { children: "Destinat\u00E1rio" }), _jsx(TableHead, { className: "text-right", children: "NFs" }), _jsx(TableHead, { className: "text-right", children: "Pallets" }), _jsx(TableHead, { className: "text-right", children: "Peso" }), _jsx(TableHead, { className: "text-right", children: "Frete" })
                                            ] }) }), _jsx(TableBody, { children: groups.map((g, i) => (_jsxs(TableRow, { children: [
                                                _jsx(TableCell, { className: "font-mono text-xs", children: i + 1 }), _jsx(TableCell, { className: "text-sm", children: g.remitter || '—' }), _jsx(TableCell, { className: "text-sm", children: g.recipient || '—' }), _jsx(TableCell, { className: "text-right", children: g.invoice_count }), _jsx(TableCell, { className: "text-right", children: g.pallet_count }), _jsx(TableCell, { className: "text-right", children: g.weight_kg.toLocaleString('pt-BR') }), _jsxs(TableCell, { className: "text-right", children: ["R$ ", g.freight_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })] })
                                            ] }, g.key))) })
                                ] }) }), _jsxs(DialogFooter, { children: [
                                _jsx(Button, { variant: "outline", onClick: () => setPreviewOpen(false), children: "Fechar" }), _jsx(Button, { onClick: () => {
                                        setPreviewOpen(false);
                                        setEmitPreviewOpen(true);
                                    }, children: "Transmitir ao Hub Fiscal" })
                            ] })
                    ] }) }), _jsx(Dialog, { open: modeDialogOpen, onOpenChange: setModeDialogOpen, children: _jsxs(DialogContent, { className: "max-w-4xl", children: [
                        _jsx(DialogHeader, { children: _jsxs(DialogTitle, { className: "flex items-center gap-2", children: [
                                    _jsx(Layers, { className: "h-4 w-4 text-primary" }),
                                    " Escolha o modo de gera\u00E7\u00E3o do conhecimento"] }) }), _jsx(TooltipProvider, { children: _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto p-1", children: GROUPING_MODES.map(m => (_jsxs(Tooltip, { children: [
                                        _jsx(TooltipTrigger, { asChild: true, children: _jsx("button", { type: "button", onClick: () => { setModeId(m.id); setModeDialogOpen(false); }, className: `text-left rounded-md border px-3 py-2 transition-colors ${modeId === m.id
                                                    ? 'border-primary bg-primary/10 text-foreground'
                                                    : 'border-border hover:bg-muted/50'}`, children: _jsxs("div", { className: "flex items-start gap-2", children: [
                                                        _jsx("span", { className: `font-mono text-xs shrink-0 mt-0.5 ${modeId === m.id ? 'text-primary' : 'text-muted-foreground'}`, children: String(m.id).padStart(2, '0') }), _jsxs("div", { className: "min-w-0", children: [
                                                                _jsx("p", { className: "text-sm font-medium truncate", children: m.shortLabel }), _jsx("p", { className: "text-xs text-muted-foreground line-clamp-1", children: m.keys.join(' • ') })
                                                            ] })
                                                    ] }) }) }), _jsxs(TooltipContent, { className: "max-w-xs", children: [
                                                _jsx("p", { className: "font-medium", children: m.label }), _jsx("p", { className: "text-xs mt-1 opacity-80", children: m.description })
                                            ] })
                                    ] }, m.id))) }) }), _jsx(DialogFooter, { children: _jsx(Button, { variant: "outline", onClick: () => setModeDialogOpen(false), children: "Fechar" }) })
                    ] }) }), _jsx(CteEmissionPreviewDialog, { open: emitPreviewOpen, onOpenChange: setEmitPreviewOpen, groups: groups })
        ] }));
}
function Stat({ label, value, highlight }) {
    return (_jsxs("div", { className: `rounded-md border p-3 ${highlight ? 'border-primary/40 bg-primary/5' : 'border-border'}`, children: [
            _jsx("p", { className: "text-xs text-muted-foreground", children: label }), _jsx("p", { className: `text-lg font-semibold ${highlight ? 'text-primary' : 'text-foreground'}`, children: value })
        ] }));
}
function Field({ label, children }) {
    return (_jsxs("div", { className: "space-y-1", children: [
            _jsx(Label, { className: "text-xs text-muted-foreground", children: label }), children] }));
}
function IssuedCtesTable() {
    const { data: ctes = [], isLoading } = useIssuedCtes();
    const [expanded, setExpanded] = useState({});
    const [cancelTarget, setCancelTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState('');
    const deleteCte = useDeleteIssuedCte();
    /** PDF/XML sob demanda: pede o arquivo ao Hub Fiscal no momento do clique. */
    async function fetchDocument(cte, kind, view = false) {
        const label = kind === 'pdf' ? 'PDF (DACTE)' : 'XML';
        if (!cte.hub_document_id) {
            toast.error(`${label} indisponível`, {
                description: 'Este CT-e ainda não tem id no Hub Fiscal — sincronize a emissão antes de baixar.',
            });
            return;
        }
        const toastId = toast.loading(`${view ? 'Abrindo' : 'Baixando'} ${label}...`);
        try {
            const blob = await hubFiscal.file(cte.hub_document_id, kind, { type: 'cte' });
            const objectUrl = URL.createObjectURL(blob);
            if (view) {
                const win = window.open(objectUrl, '_blank');
                if (!win)
                    toast.warning('Pop-up bloqueado — use o botão de download.');
            }
            else {
                const a = document.createElement('a');
                a.href = objectUrl;
                a.download = `cte-${cte.access_key || cte.invoice_number || cte.id}.${kind}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
            setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
            toast.success(`${label} ${view ? 'aberto' : 'baixado'}`, { id: toastId });
        }
        catch (e) {
            toast.error(`Falha ao obter ${label}`, { id: toastId, description: e?.message });
        }
    }
    if (isLoading) {
        return _jsx("p", { className: "text-sm text-muted-foreground py-8 text-center", children: "Carregando..." });
    }
    if (ctes.length === 0) {
        return (_jsx("p", { className: "text-sm text-muted-foreground py-8 text-center", children: "Nenhum CT-e transmitido ao Hub Fiscal ainda." }));
    }
    return (_jsxs(_Fragment, { children: [
            _jsxs(Table, { children: [
                    _jsx(TableHeader, { children: _jsxs(TableRow, { children: [
                                _jsx(TableHead, { className: "w-8" }), _jsx(TableHead, { children: "Data" }), _jsx(TableHead, { children: "N\u00BA / Chave" }), _jsx(TableHead, { children: "Remetente" }), _jsx(TableHead, { children: "Destinat\u00E1rio" }), _jsx(TableHead, { className: "text-right", children: "NFs" }), _jsx(TableHead, { className: "text-right", children: "Frete" }), _jsx(TableHead, { children: "Status" }), _jsx(TableHead, { className: "text-right", children: "A\u00E7\u00F5es" })
                            ] }) }), _jsx(TableBody, { children: ctes.map(c => {
                            const open = !!expanded[c.id];
                            return (_jsxs(Fragment, { children: [
                                    _jsxs(TableRow, { className: "cursor-pointer", onClick: () => setExpanded(p => ({ ...p, [c.id]: !open })), children: [
                                            _jsx(TableCell, { children: open ? _jsx(ChevronDown, { className: "h-4 w-4" }) : _jsx(ChevronRight, { className: "h-4 w-4" }) }), _jsx(TableCell, { className: "text-sm", children: format(new Date(c.created_at), 'dd/MM/yyyy HH:mm') }), _jsx(TableCell, { className: "text-xs font-mono", children: c.access_key || c.invoice_number || '—' }), _jsx(TableCell, { className: "text-sm", children: c.remitter || '—' }), _jsxs(TableCell, { className: "text-sm", children: [c.recipient || '—', c.recipient_city ? _jsxs("span", { className: "text-muted-foreground text-xs", children: [" \u2022 ", c.recipient_city, "/", c.recipient_state] }) : null] }), _jsx(TableCell, { className: "text-right font-medium", children: c.notes.length }), _jsxs(TableCell, { className: "text-right", children: ["R$ ", c.freight_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })] }), _jsx(TableCell, { children: _jsx(Badge, { variant: "outline", className: c.sefaz_status === 'cancel_rejected' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                                                        c.status === 'authorized' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                                                            c.status === 'rejected' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                                                                c.status === 'cancelled' ? 'bg-muted text-muted-foreground' :
                                                                    'bg-amber-500/10 text-amber-600 border-amber-500/20', title: c.sefaz_message || undefined, children: c.sefaz_status === 'cancel_rejected' ? 'Cancelamento rejeitado'
                                                        : c.status === 'authorized' ? 'Autorizado'
                                                            : c.status === 'rejected' ? 'Rejeitado'
                                                                : c.status === 'cancelled' ? 'Cancelado'
                                                                    : 'Transmitindo' }) }), _jsx(TableCell, { className: "text-right", onClick: (e) => e.stopPropagation(), children: _jsxs("div", { className: "flex items-center justify-end gap-1", children: [
                                                        _jsx(Button, { variant: "ghost", size: "sm", title: "Visualizar DACTE (PDF) \u2014 busca sob demanda no Hub Fiscal", onClick: () => fetchDocument(c, 'pdf', true), children: _jsx(Eye, { className: "h-4 w-4" }) }), _jsx(Button, { variant: "ghost", size: "sm", title: "Baixar PDF (DACTE)", onClick: () => fetchDocument(c, 'pdf'), children: _jsx(FileText, { className: "h-4 w-4" }) }), _jsx(Button, { variant: "ghost", size: "sm", title: "Baixar XML", onClick: () => fetchDocument(c, 'xml'), children: _jsx(FileDown, { className: "h-4 w-4" }) }), c.status !== 'cancelled' && c.sefaz_status !== 'cancel_rejected' && (_jsxs(Button, { variant: "ghost", size: "sm", className: "text-destructive hover:text-destructive", disabled: !c.hub_document_id, title: c.hub_document_id ? 'Cancelar CT-e na SEFAZ' : 'CT-e ainda não transmitido ao Hub Fiscal', onClick: () => setCancelTarget({
                                                                id: c.id,
                                                                label: c.invoice_number ? `nº ${c.invoice_number}` : c.id.slice(0, 8),
                                                                accessKey: c.access_key,
                                                                notesCount: c.notes.length,
                                                            }), children: [
                                                                _jsx(XCircle, { className: "h-4 w-4 mr-1" }),
                                                                " Cancelar"] })), (c.status !== 'authorized' || c.sefaz_status === 'cancel_rejected' || c.sefaz_status === 'cancelled') && (_jsxs(Button, { variant: "ghost", size: "sm", className: "text-destructive hover:text-destructive", title: "Excluir registro local do CT-e e liberar as NFs vinculadas", onClick: () => setDeleteTarget({
                                                                id: c.id,
                                                                label: c.invoice_number ? `nº ${c.invoice_number}` : c.id.slice(0, 8),
                                                                notesCount: c.notes.length,
                                                                authorized: c.sefaz_status === 'cancel_rejected',
                                                            }), children: [
                                                                _jsx(Trash2, { className: "h-4 w-4 mr-1" }),
                                                                " Excluir"] }))] }) })
                                        ] }), open && (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 9, className: "bg-muted/30", children: c.notes.length === 0 ? (_jsx("p", { className: "text-xs text-muted-foreground py-2", children: "Nenhuma NF vinculada a este CT-e." })) : (_jsxs("div", { className: "py-1", children: [
                                                    _jsx("p", { className: "text-xs text-muted-foreground mb-1", children: "NFs agrupadas neste CT-e" }), _jsx("div", { className: "flex flex-wrap gap-1", children: c.notes.map(n => (_jsxs(Badge, { variant: "secondary", className: "font-mono text-xs", children: ["NF ", n.invoice_number || n.id.slice(0, 8), " \u2022 R$ ", n.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })] }, n.id))) })
                                                ] })) }) }))] }, c.id));
                        }) })
                ] }), _jsx(CancelCteDialog, { target: cancelTarget, onOpenChange: (o) => !o && setCancelTarget(null) }), _jsx(AlertDialog, { open: !!deleteTarget, onOpenChange: (o) => { if (!o) {
                    setDeleteTarget(null);
                    setDeleteConfirm('');
                } }, children: _jsxs(AlertDialogContent, { children: [
                        _jsxs(AlertDialogHeader, { children: [
                                _jsxs(AlertDialogTitle, { children: ["Excluir CT-e ", deleteTarget?.label, "?"] }), _jsx(AlertDialogDescription, { asChild: true, children: _jsxs("div", { className: "space-y-2 text-sm", children: [
                                            _jsxs("p", { children: ["O registro local ser\u00E1 removido e ", deleteTarget?.notesCount ?? 0, " NF(s) vinculada(s) voltar\u00E3o a ficar dispon\u00EDveis para novo faturamento."] }), deleteTarget?.authorized && (_jsx("p", { className: "text-destructive font-medium", children: "Aten\u00E7\u00E3o: este CT-e teve o cancelamento rejeitado pela SEFAZ, portanto continua v\u00E1lido fiscalmente. Excluir aqui remove apenas o controle interno \u2014 o documento permanece na SEFAZ e deve ser tratado com CT-e de anula\u00E7\u00E3o/substitui\u00E7\u00E3o." })), _jsxs("p", { children: ["Digite ",
                                                    _jsx("span", { className: "font-mono font-semibold", children: "EXCLUIR" }),
                                                    " para confirmar."] })
                                        ] }) })
                            ] }), _jsx(Input, { value: deleteConfirm, onChange: (e) => setDeleteConfirm(e.target.value.toUpperCase()), placeholder: "EXCLUIR", className: "font-mono" }), _jsxs(AlertDialogFooter, { children: [
                                _jsx(AlertDialogCancel, { children: "Voltar" }), _jsx(AlertDialogAction, { disabled: deleteConfirm !== 'EXCLUIR' || deleteCte.isPending, onClick: (e) => {
                                        e.preventDefault();
                                        if (!deleteTarget)
                                            return;
                                        deleteCte.mutate(deleteTarget.id, {
                                            onSuccess: () => {
                                                toast.success('CT-e excluído — NFs liberadas para novo faturamento');
                                                setDeleteTarget(null);
                                                setDeleteConfirm('');
                                            },
                                            onError: (err) => toast.error(err?.message || 'Falha ao excluir CT-e'),
                                        });
                                    }, children: deleteCte.isPending ? 'Excluindo...' : 'Excluir CT-e' })
                            ] })
                    ] }) })
        ] }));
}
