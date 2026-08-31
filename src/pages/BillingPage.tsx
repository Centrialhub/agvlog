import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useBillingDocuments } from '@/hooks/useBillingDocuments';
import { useClients } from '@/hooks/useClients';
import { useLoads, LOAD_STATUSES, LOAD_STATUS_LABELS } from '@/hooks/useLoads';
import { useCteBatches, useCancelCteBatch, useIssuedCtes, useDeleteIssuedCte } from '@/hooks/useBilling';
import { GROUPING_MODES, buildGroups, getGroupingMode, type CteGroupPreview } from '@/lib/cteGroupingModes';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { useSortableData } from '@/hooks/useSortableData';
import { usePagination } from '@/hooks/usePagination';
import { DataPagination } from '@/components/ui/data-pagination';
import { format } from 'date-fns';
import { PendingInvoicesBanner } from '@/components/billing/PendingInvoicesBanner';
import { normalizeCity } from '@/lib/utils/normalizeCity';
import { useRecalculateInboundFreight } from '@/hooks/useRecalculateInboundFreight';
import { CteEmissionPreviewDialog } from '@/components/billing/CteEmissionPreviewDialog';
import { CancelCteDialog, type CancelCteTarget } from '@/components/billing/CancelCteDialog';
import {
  OPERATION_TYPE_OPTIONS,
  type OperationType,
} from '@/lib/operationTypeMapping';

const SENTINEL_NONE = '__none__';

type SourceTab = 'period' | 'loads';

const OPERATION_TYPES = OPERATION_TYPE_OPTIONS;
type OpType = OperationType;

function matchesOperation(
  opType: string | null | undefined,
  allOperations: boolean,
  selectedOperations: ReadonlySet<OpType>,
) {
  if (allOperations || selectedOperations.size === 0) return true;
  return opType ? selectedOperations.has(opType as OpType) : false;
}

function ciIncludes(haystack: string | null | undefined, needle: string) {
  return !needle || (haystack || '').toLowerCase().includes(needle.toLowerCase());
}

// ============================================================================
// Preferências do usuário — persistência por tenant
// ============================================================================
interface BillingPreferences {
  tab: SourceTab;
  clientId: string;
  supplierId: string;
  periodStart: string;
  periodEnd: string;
  modeId: number;
  // Filtros SIAT
  osNumber: string;
  collectOrder: string;
  referenceNumber: string;
  cnpj: string;
  invoiceNumber: string;
  issueDateStart: string;
  issueDateEnd: string;
  importDateStart: string;
  importDateEnd: string;
  supplierManifest: string;
  distributionManifest: string;
  shipmentManifest: string;
  originManifest: string;
  loadStatus: string;
  plate: string;
  scheduledLoadStart: string;
  scheduledLoadEnd: string;
  actualLoadStart: string;
  actualLoadEnd: string;
  supplier: string;
  supplierCnpj: string;
  accessKey: string;
  opTypes: OpType[];
  allOps: boolean;
}

const DEFAULT_BILLING_PREFS: BillingPreferences = {
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
  const toast = useSonnerToast();
  const { data: clients = [] } = useClients();
  const { data: loads = [] } = useLoads();
  const { data: batches = [] } = useCteBatches();
  const cancelBatch = useCancelCteBatch();
  const { currentTenant } = useTenant();
  const recalcFreight = useRecalculateInboundFreight();

  // Preferência por tenant (chave isolada por workspace)
  const prefKey = `billing:filters:${currentTenant?.id ?? 'none'}`;
  const { preference, isLoaded, savePreference } = useUserUiPreference<BillingPreferences>(
    prefKey,
    DEFAULT_BILLING_PREFS,
  );

  const [tab, setTab] = useState<SourceTab>('period');
  const [clientId, setClientId] = useState<string>(SENTINEL_NONE);
  const [supplierId, setSupplierId] = useState<string>(SENTINEL_NONE);
  const [periodStart, setPeriodStart] = useState<string>('');
  const [periodEnd, setPeriodEnd] = useState<string>('');
  const [selectedLoadIds, setSelectedLoadIds] = useState<Set<string>>(new Set());
  const [recipientCity, setRecipientCity] = useState<string>(SENTINEL_NONE);
  const [modeId, setModeId] = useState<number>(1);
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
  const [loadStatus, setLoadStatus] = useState<string>(SENTINEL_NONE);
  const [plate, setPlate] = useState('');
  const [scheduledLoadStart, setScheduledLoadStart] = useState('');
  const [scheduledLoadEnd, setScheduledLoadEnd] = useState('');
  const [actualLoadStart, setActualLoadStart] = useState('');
  const [actualLoadEnd, setActualLoadEnd] = useState('');
  const [supplier, setSupplier] = useState('');
  const [supplierCnpj, setSupplierCnpj] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [opTypes, setOpTypes] = useState<Set<OpType>>(new Set());
  const [allOps, setAllOps] = useState(true);

  // ===== Pré-filtragem server-side (usa índices criados) =====
  const [onlySpecific, setOnlySpecific] = useState<boolean>(false);
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
    const m = new Map<string, typeof loads[number]>();
    for (const l of loads) m.set(l.id, l);
    return m;
  }, [loads]);


  const { sortedItems: filteredDocs, requestSort, sortConfig } = useSortableData(
    useMemo(() => {
      return docs.filter(d => {
        if (tab === 'loads') {
          if (!d.load_id || !selectedLoadIds.has(d.load_id)) return false;
        }

        // Janela secundária de emissão (independente do tab)
        if (issueDateStart && (!d.issue_date || d.issue_date < issueDateStart)) return false;
        if (issueDateEnd && (!d.issue_date || d.issue_date > issueDateEnd)) return false;

        // Janela de data de importação (created_at do documento fiscal)
        if (importDateStart || importDateEnd) {
          const imp = d.created_at ? d.created_at.slice(0, 10) : null;
          if (!imp) return false;
          if (importDateStart && imp < importDateStart) return false;
          if (importDateEnd && imp > importDateEnd) return false;
        }

        // Filtros que dependem da carga associada
        const load = d.load_id ? loadsById.get(d.load_id) : null;
        if (osNumber && !ciIncludes(load?.os_number, osNumber)) return false;
        if (collectOrder && !ciIncludes(load?.load_number, collectOrder)) return false;
        if (loadStatus !== SENTINEL_NONE && load?.status !== loadStatus) return false;
        if (plate && !ciIncludes(load?.vehicles?.plate, plate)) return false;
        if (supplierManifest && !ciIncludes(load?.supplier_manifest, supplierManifest)) return false;
        if (distributionManifest && !ciIncludes(load?.distribution_manifest, distributionManifest)) return false;
        if (shipmentManifest && !ciIncludes(load?.shipment_manifest, shipmentManifest)) return false;
        if (originManifest && !ciIncludes(load?.origin_manifest, originManifest)) return false;
        // Janelas de carregamento (agendado/realizado) — comparam apenas a parte de data
        if (scheduledLoadStart || scheduledLoadEnd) {
          const sch = load?.scheduled_load_at ? load.scheduled_load_at.slice(0, 10) : null;
          if (!sch) return false;
          if (scheduledLoadStart && sch < scheduledLoadStart) return false;
          if (scheduledLoadEnd && sch > scheduledLoadEnd) return false;
        }
        if (actualLoadStart || actualLoadEnd) {
          const act = load?.actual_load_at ? load.actual_load_at.slice(0, 10) : null;
          if (!act) return false;
          if (actualLoadStart && act < actualLoadStart) return false;
          if (actualLoadEnd && act > actualLoadEnd) return false;
        }
        if (!matchesOperation(load?.operation_type ?? d.operation_type, allOps, opTypes)) return false;

        // Cidade do destinatário (já filtrada server-side se selecionada, mas mantida para consistência no client)
        if (recipientCity !== SENTINEL_NONE && normalizeCity(d.recipient_city) !== recipientCity) return false;

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
    ])
  );
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const documentsPagination = usePagination(filteredDocs, {
    pageSize: 50,
    resetKey: [
      tab, periodStart, periodEnd, invoiceNumber, accessKey, supplier, supplierCnpj,
      recipientCity, osNumber, collectOrder, issueDateStart, issueDateEnd,
      importDateStart, importDateEnd, loadStatus, plate,
      [...selectedLoadIds].sort().join(','), [...opTypes].sort().join(','), String(allOps),
    ].join('|'),
  });

  // ===== Hidrata estado a partir da preferência salva (uma única vez) =====
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!isLoaded || hydratedRef.current || !preference) return;
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
    if (!isLoaded || !hydratedRef.current) return undefined;
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

  const toggleOp = (op: OpType) => {
    setAllOps(false);
    setOpTypes(prev => {
      const next = new Set(prev);
      if (next.has(op)) next.delete(op);
      else next.add(op);
      return next;
    });
  };

  const clearAdvanced = () => {
    setOsNumber(''); setCollectOrder(''); setReferenceNumber(''); setCnpj('');
    setInvoiceNumber(''); setIssueDateStart(''); setIssueDateEnd('');
    setImportDateStart(''); setImportDateEnd('');
    setSupplierManifest(''); setDistributionManifest(''); setShipmentManifest(''); setOriginManifest('');
    setLoadStatus(SENTINEL_NONE); setPlate('');
    setScheduledLoadStart(''); setScheduledLoadEnd(''); setActualLoadStart(''); setActualLoadEnd('');
    setSupplier(''); setSupplierCnpj(''); setAccessKey('');
    setOpTypes(new Set()); setAllOps(true);
  };




  // Cidades de destino disponíveis nas notas elegíveis (chave normalizada -> rótulo exibido)
  const recipientCityOptions = useMemo(() => {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const d of docs) {
      const key = normalizeCity(d.recipient_city);
      if (!key) continue;
      const label = `${d.recipient_city}${d.recipient_state ? `/${d.recipient_state}` : ''}`;
      const cur = m.get(key);
      if (cur) cur.count += 1;
      else m.set(key, { key, label, count: 1 });
    }
    return Array.from(m.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [docs]);

  // Se o operador marcou notas específicas, restringe a elas. Caso contrário,
  // usa todas as notas resultantes dos filtros (comportamento por lote antigo).
  const eligibleDocs = useMemo(() => {
    if (selectedDocIds.size === 0) return filteredDocs;
    return filteredDocs.filter(d => selectedDocIds.has(d.id));
  }, [filteredDocs, selectedDocIds]);

  // Limpa seleções que deixaram de fazer parte do universo filtrado.
  useEffect(() => {
    if (selectedDocIds.size === 0 || docsLoading) return;
    const valid = new Set(filteredDocs.map(d => d.id));
    let changed = false;
    const next = new Set<string>();
    selectedDocIds.forEach(id => {
      if (valid.has(id)) next.add(id);
      else changed = true;
    });
    if (changed) setSelectedDocIds(next);
  }, [filteredDocs, docsLoading, selectedDocIds]);

  const toggleDoc = (id: string) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllDocs = () => setSelectedDocIds(new Set(filteredDocs.map(d => d.id)));
  const clearDocSelection = () => setSelectedDocIds(new Set());

  const groups: CteGroupPreview[] = useMemo(
    () => buildGroups(eligibleDocs, modeId),
    [eligibleDocs, modeId],
  );

  const totals = useMemo(() => ({
    docs: eligibleDocs.length,
    cargo: eligibleDocs.reduce((s, d) => s + (Number(d.value) || 0), 0),
    freight: eligibleDocs.reduce((s, d) => s + (Number(d.freight_value) || 0), 0),
    pallets: eligibleDocs.reduce((s, d) => s + (d.pallet_count || 0), 0),
    weight: eligibleDocs.reduce((s, d) => s + (Number(d.weight_kg) || 0), 0),
  }), [eligibleDocs]);

  const billableLoads = useMemo(() => loads.filter(l =>
    clientId === SENTINEL_NONE ? true : docs.some(d => d.load_id === l.id && d.client_id === clientId)
  ), [loads, docs, clientId]);

  const toggleLoad = (id: string) => {
    setSelectedLoadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  return (
    <div className="animate-fade-in space-y-6">
      <PendingInvoicesBanner from="billing" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-primary" /> Faturamento (CT-e / Conhecimento)
          </h1>
          <p className="text-sm text-muted-foreground">
            Gere conhecimentos de transporte agrupando notas pelos 14 modos disponíveis. Os CT-es alimentam Contas a Receber automaticamente.
          </p>
        </div>
      </div>

      {/* Configuração */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Selecione a base de faturamento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              const next = v as SourceTab;
              setTab(next);
              if (next === 'period') setClientId(SENTINEL_NONE);
              if (next === 'loads') setSupplierId(SENTINEL_NONE);
            }}
          >
            <TabsList>
              <TabsTrigger value="period">Por fornecedor / período</TabsTrigger>
              <TabsTrigger value="loads">Por cargas</TabsTrigger>
            </TabsList>

            <TabsContent value="period" className="space-y-3 pt-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <Label>Fornecedor</Label>
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger><SelectValue placeholder="Selecione um fornecedor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SENTINEL_NONE}>Todos os fornecedores</SelectItem>
                      {clients.filter(c => c.is_supplier).map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.company_name}{c.tax_id ? ` — ${c.tax_id}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Vínculo direto pelo CNPJ do remetente da NF-e. Cadastre fornecedores em <span className="font-medium">Clientes e Fornecedores</span>.
                  </p>
                </div>
                <div className="md:col-span-2 grid grid-cols-2 gap-2">
                  <div>
                    <Label>Início</Label>
                    <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                  </div>
                  <div>
                    <Label>Fim</Label>
                    <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="loads" className="space-y-3 pt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Cliente (opcional)</Label>
                  <Select value={clientId} onValueChange={setClientId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SENTINEL_NONE}>Todos os clientes</SelectItem>
                      {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="rounded-md border max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Carga</TableHead>
                      <TableHead>Origem → Destino</TableHead>
                      <TableHead className="text-right">Pallets</TableHead>
                      <TableHead className="text-right">Peso (kg)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billableLoads.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nenhuma carga disponível</TableCell></TableRow>
                    ) : billableLoads.map(l => (
                      <TableRow key={l.id} className="cursor-pointer" onClick={() => toggleLoad(l.id)}>
                        <TableCell><Checkbox checked={selectedLoadIds.has(l.id)} /></TableCell>
                        <TableCell className="font-mono text-sm">{l.load_number}</TableCell>
                        <TableCell className="text-sm">{l.origin || '—'} → {l.destination || '—'}</TableCell>
                        <TableCell className="text-right text-sm">{l.total_pallet_count || 0}</TableCell>
                        <TableCell className="text-right text-sm">{Number(l.total_weight_kg || 0).toLocaleString('pt-BR')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Filtros avançados (SIAT) */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" /> Filtros avançados (geração automática)
            {activeFilterCount > 0 && (
              <Badge variant="outline" className="ml-2 bg-primary/10 text-primary border-primary/30">
                {activeFilterCount} ativo{activeFilterCount > 1 ? 's' : ''}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Save className="h-3 w-3" /> Preferências salvas automaticamente
            </span>
            <Button variant="ghost" size="sm" onClick={clearAdvanced} disabled={activeFilterCount === 0}>
              <Eraser className="h-4 w-4 mr-1" /> Limpar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <Field label="Remetente"><Input value={supplier} onChange={e => setSupplier(e.target.value)} /></Field>
            <Field label="Cliente"><Input value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" /></Field>
            <Field label="Município">
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={recipientCity}
                onChange={e => setRecipientCity(e.target.value)}
              >
                <option value={SENTINEL_NONE}>Todos os municípios</option>
                {recipientCityOptions.map(opt => (
                  <option key={opt.key} value={opt.key}>{opt.label} ({opt.count})</option>
                ))}
              </select>
            </Field>
            <Field label="Fornecedor"><Input value={supplierCnpj} onChange={e => setSupplierCnpj(e.target.value)} placeholder="CNPJ do fornecedor" /></Field>

            <Field label="Nº OS"><Input value={osNumber} onChange={e => setOsNumber(e.target.value)} /></Field>
            <Field label="Ordem de Coleta"><Input value={collectOrder} onChange={e => setCollectOrder(e.target.value)} /></Field>
            <Field label="Nº Referência"><Input value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} /></Field>
            <Field label="Nota Fiscal"><Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></Field>
            <Field label="Emissão NF — Início"><Input type="date" value={issueDateStart} onChange={e => setIssueDateStart(e.target.value)} /></Field>
            <Field label="Emissão NF — Fim"><Input type="date" value={issueDateEnd} onChange={e => setIssueDateEnd(e.target.value)} /></Field>
            <Field label="Chave Acesso CT-e"><Input value={accessKey} onChange={e => setAccessKey(e.target.value)} placeholder="44 dígitos" /></Field>

            <Field label="Importação — Início"><Input type="date" value={importDateStart} onChange={e => setImportDateStart(e.target.value)} /></Field>
            <Field label="Importação — Fim"><Input type="date" value={importDateEnd} onChange={e => setImportDateEnd(e.target.value)} /></Field>

            <Field label="Romaneio do Fornecedor"><Input value={supplierManifest} onChange={e => setSupplierManifest(e.target.value)} /></Field>
            <Field label="Romaneio de Distribuição"><Input value={distributionManifest} onChange={e => setDistributionManifest(e.target.value)} /></Field>
            <Field label="Romaneio de Expedição"><Input value={shipmentManifest} onChange={e => setShipmentManifest(e.target.value)} /></Field>
            <Field label="Romaneio Origem"><Input value={originManifest} onChange={e => setOriginManifest(e.target.value)} /></Field>

            <Field label="Status da Carga">
              <Select value={loadStatus} onValueChange={setLoadStatus}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SENTINEL_NONE}>Todos</SelectItem>
                  {LOAD_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{LOAD_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Placa"><Input value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="ABC1D23" /></Field>
            <Field label="Identificação Remetente"><Input value={supplier} onChange={e => setSupplier(e.target.value)} /></Field>
            <Field label="Identificação Fornecedor"><Input value={supplierCnpj} onChange={e => setSupplierCnpj(e.target.value)} /></Field>

            <Field label="Carregamento Previsto — Início"><Input type="date" value={scheduledLoadStart} onChange={e => setScheduledLoadStart(e.target.value)} /></Field>
            <Field label="Carregamento Previsto — Fim"><Input type="date" value={scheduledLoadEnd} onChange={e => setScheduledLoadEnd(e.target.value)} /></Field>
            <Field label="Carregamento Real — Início"><Input type="date" value={actualLoadStart} onChange={e => setActualLoadStart(e.target.value)} /></Field>
            <Field label="Carregamento Real — Fim"><Input type="date" value={actualLoadEnd} onChange={e => setActualLoadEnd(e.target.value)} /></Field>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Tipos de operação</Label>
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={allOps}
                  onCheckedChange={(v) => { setAllOps(!!v); if (v) setOpTypes(new Set()); }}
                />
                <span className="font-medium">Todos</span>
              </label>
              {OPERATION_TYPES.map(op => (
                <label key={op.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={!allOps && opTypes.has(op.value)}
                    onCheckedChange={() => toggleOp(op.value)}
                  />
                  <span>{op.label}</span>
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Seleção de notas */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> 2. Selecionar notas
            <Badge variant="outline" className="ml-2">
              {selectedDocIds.size > 0
                ? `${selectedDocIds.size} selecionada${selectedDocIds.size > 1 ? 's' : ''}`
                : `${filteredDocs.length} elegíveis`}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={selectAllDocs} disabled={filteredDocs.length === 0}>
              Selecionar todas
            </Button>
            <Button variant="ghost" size="sm" onClick={clearDocSelection} disabled={selectedDocIds.size === 0}>
              <Eraser className="h-4 w-4 mr-1" /> Limpar seleção
            </Button>
            <Button 
              variant={onlySpecific ? "default" : "outline"} 
              size="sm" 
              onClick={() => setOnlySpecific(!onlySpecific)}
              className={onlySpecific ? "bg-amber-600 hover:bg-amber-700" : ""}
            >
              {onlySpecific ? "Mostrando 13" : "Isolar as 13"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filteredDocs.length === 0}
              onClick={() => {
                const docsToExport = selectedDocIds.size > 0
                  ? filteredDocs.filter(d => selectedDocIds.has(d.id))
                  : filteredDocs;

                const escape = (value: unknown) => {
                  if (value === null || value === undefined) return '';
                  return String(value)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&apos;');
                };

                const formatDate = (date: string | null) => {
                  if (!date) return '';
                  try {
                    return format(new Date(date), 'dd/MM/yyyy');
                  } catch {
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
              }}
            >
              <FileDown className="h-4 w-4 mr-1" /> Exportar XML
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filteredDocs.length === 0 || recalcFreight.isPending}
              onClick={async () => {
                const ids = (selectedDocIds.size > 0
                  ? filteredDocs.filter(d => selectedDocIds.has(d.id))
                  : filteredDocs
                ).map(d => d.id);
                if (ids.length === 0) return;
                const r = await recalcFreight.mutateAsync(ids);
                toast.success(`Fretes recalculados: ${r.updated} atualizadas, ${r.skipped} ignoradas, ${r.failed} falhas`);
              }}
            >
              <Calculator className="h-4 w-4 mr-1" />
              {recalcFreight.isPending ? 'Recalculando…' : 'Recalcular fretes'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="px-6 pb-3 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 min-w-[240px]">
              <Label className="text-xs text-muted-foreground">Cidade do destinatário</Label>
              <Select value={recipientCity} onValueChange={setRecipientCity}>
                <SelectTrigger><SelectValue placeholder="Todas as cidades" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SENTINEL_NONE}>Todas as cidades</SelectItem>
                  {recipientCityOptions.map(c => (
                    <SelectItem key={c.key} value={c.key}>{c.label} ({c.count})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {recipientCity !== SENTINEL_NONE && (
              <Button variant="ghost" size="sm" onClick={() => setRecipientCity(SENTINEL_NONE)}>
                <Eraser className="h-4 w-4 mr-1" /> Limpar cidade
              </Button>
            )}
          </div>
          <p className="px-6 pb-3 text-xs text-muted-foreground">
            Se nenhuma nota estiver marcada, todas as {filteredDocs.length} notas filtradas serão faturadas (modo lote).
            Marque notas específicas para gerar apenas os CT-es correspondentes.
          </p>
          <div className="max-h-96 overflow-y-auto border-t">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={filteredDocs.length > 0 && selectedDocIds.size === filteredDocs.length}
                      onCheckedChange={(v) => v ? selectAllDocs() : clearDocSelection()}
                    />
                  </TableHead>
                  <TableHead sortKey="invoice_number" sortConfig={sortConfig} onSort={requestSort}>NF</TableHead>
                  <TableHead sortKey="issue_date" sortConfig={sortConfig} onSort={requestSort}>Emissão</TableHead>
                  <TableHead sortKey="remitter" sortConfig={sortConfig} onSort={requestSort}>Remetente</TableHead>
                  <TableHead sortKey="recipient" sortConfig={sortConfig} onSort={requestSort}>Destinatário</TableHead>
                  <TableHead sortKey="recipient_city" sortConfig={sortConfig} onSort={requestSort}>Cidade destino</TableHead>
                  <TableHead className="text-right" sortKey="pallet_count" sortConfig={sortConfig} onSort={requestSort}>Pallets</TableHead>
                  <TableHead className="text-right" sortKey="weight_kg" sortConfig={sortConfig} onSort={requestSort}>Peso</TableHead>
                  <TableHead className="text-right" sortKey="value" sortConfig={sortConfig} onSort={requestSort}>Valor</TableHead>
                  <TableHead className="text-right" sortKey="freight_value" sortConfig={sortConfig} onSort={requestSort}>Frete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docsLoading ? (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">Carregando...</TableCell></TableRow>
                ) : filteredDocs.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">Nenhuma nota disponível com os filtros atuais.</TableCell></TableRow>
                ) : documentsPagination.items.map(d => (
                  <TableRow key={d.id} className="cursor-pointer" onClick={() => toggleDoc(d.id)}>
                    <TableCell><Checkbox checked={selectedDocIds.has(d.id)} /></TableCell>
                    <TableCell className="font-mono text-xs">{d.invoice_number || '—'}</TableCell>
                    <TableCell className="text-sm">{d.issue_date ? format(new Date(d.issue_date), 'dd/MM/yyyy') : '—'}</TableCell>
                    <TableCell className="text-sm truncate max-w-[220px]">{d.remitter || '—'}</TableCell>
                    <TableCell className="text-sm truncate max-w-[220px]">{d.recipient || d.clients?.company_name || '—'}</TableCell>
                    <TableCell className="text-sm">
                      {d.recipient_city
                        ? `${d.recipient_city}${d.recipient_state ? `/${d.recipient_state}` : ''}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm">{d.pallet_count || 0}</TableCell>
                    <TableCell className="text-right text-sm">{Number(d.weight_kg || 0).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-right text-sm">R$ {Number(d.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right text-sm">
                      {d.freight_value
                        ? `R$ ${Number(d.freight_value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DataPagination {...documentsPagination} onPageChange={documentsPagination.setPage} />
        </CardContent>
      </Card>

      {/* Modo de agrupamento */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> 3. Modo de geração do conhecimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="flex items-start gap-3 min-w-0">
              <Badge variant="outline" className="font-mono shrink-0">#{String(mode.id).padStart(2, '0')}</Badge>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{mode.label}</p>
                <p className="text-xs text-muted-foreground line-clamp-1">{mode.description}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setModeDialogOpen(true)}>
              Alterar modo
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" /> 4. Prévia do faturamento
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Notas elegíveis" value={totals.docs} />
            <Stat label="CT-es a gerar" value={groups.length} highlight />
            <Stat label="Valor da carga" value={`R$ ${totals.cargo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
            <Stat label="Frete total" value={`R$ ${totals.freight.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
            <Stat label="Peso (kg)" value={totals.weight.toLocaleString('pt-BR')} />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            Modo selecionado: <strong className="text-foreground">{mode.label}</strong>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={groups.length === 0} onClick={() => setPreviewOpen(true)}>
              Ver prévia ({groups.length})
            </Button>
            <Button
              disabled={groups.length === 0}
              onClick={() => setEmitPreviewOpen(true)}
            >
              Prévia editável &amp; transmitir ({groups.length})
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Histórico de lotes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> CT-es transmitidos &amp; notas vinculadas
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <IssuedCtesTable />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Lotes gerados
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Modo</TableHead>
                <TableHead className="text-right">CT-es</TableHead>
                <TableHead className="text-right">Frete</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {docsLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : batches.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum lote gerado ainda</TableCell></TableRow>
              ) : batches.map(b => (
                <TableRow key={b.id}>
                  <TableCell className="text-sm">{format(new Date(b.created_at), 'dd/MM/yyyy HH:mm')}</TableCell>
                  <TableCell className="text-sm">{b.clients?.company_name || '—'}</TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="outline" className="font-mono">#{String(b.grouping_mode).padStart(2, '0')}</Badge>{' '}
                    <span className="text-muted-foreground text-xs">{b.grouping_mode_label}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium">{b.total_documents}</TableCell>
                  <TableCell className="text-right">R$ {Number(b.total_freight).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      b.status === 'generated' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                      b.status === 'cancelled' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                      'bg-amber-500/10 text-amber-600 border-amber-500/20'
                    }>
                      {b.status === 'generated'
                        ? 'Rascunho local (não transmitido)'
                        : b.status === 'cancelled'
                          ? 'Cancelado'
                          : 'Rascunho'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {b.status !== 'cancelled' && (
                      <Button variant="ghost" size="sm" onClick={() => cancelBatch.mutate(b.id)}>
                        <XCircle className="h-4 w-4 mr-1" /> Cancelar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Prévia dos CT-es a gerar</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Remetente</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead className="text-right">NFs</TableHead>
                  <TableHead className="text-right">Pallets</TableHead>
                  <TableHead className="text-right">Peso</TableHead>
                  <TableHead className="text-right">Frete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g, i) => (
                  <TableRow key={g.key}>
                    <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                    <TableCell className="text-sm">{g.remitter || '—'}</TableCell>
                    <TableCell className="text-sm">{g.recipient || '—'}</TableCell>
                    <TableCell className="text-right">{g.invoice_count}</TableCell>
                    <TableCell className="text-right">{g.pallet_count}</TableCell>
                    <TableCell className="text-right">{g.weight_kg.toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-right">R$ {g.freight_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Fechar</Button>
            <Button
              onClick={() => {
                setPreviewOpen(false);
                setEmitPreviewOpen(true);
              }}
            >
              Transmitir ao Hub Fiscal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mode selection dialog */}
      <Dialog open={modeDialogOpen} onOpenChange={setModeDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" /> Escolha o modo de geração do conhecimento
            </DialogTitle>
          </DialogHeader>
          <TooltipProvider>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto p-1">
              {GROUPING_MODES.map(m => (
                <Tooltip key={m.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => { setModeId(m.id); setModeDialogOpen(false); }}
                      className={`text-left rounded-md border px-3 py-2 transition-colors ${
                        modeId === m.id
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`font-mono text-xs shrink-0 mt-0.5 ${modeId === m.id ? 'text-primary' : 'text-muted-foreground'}`}>
                          {String(m.id).padStart(2, '0')}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{m.shortLabel}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1">{m.keys.join(' • ')}</p>
                        </div>
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="font-medium">{m.label}</p>
                    <p className="text-xs mt-1 opacity-80">{m.description}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModeDialogOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CteEmissionPreviewDialog
        open={emitPreviewOpen}
        onOpenChange={setEmitPreviewOpen}
        groups={groups}
      />
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function IssuedCtesTable() {
  const toast = useSonnerToast();
  const { data: ctes = [], isLoading } = useIssuedCtes();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cancelTarget, setCancelTarget] = useState<CancelCteTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string; notesCount: number; authorized: boolean } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const deleteCte = useDeleteIssuedCte();

  /** PDF/XML sob demanda: pede o arquivo ao Hub Fiscal no momento do clique. */
  async function fetchDocument(
    cte: { id: string; hub_document_id: string | null; access_key: string | null; invoice_number: string | null },
    kind: 'pdf' | 'xml',
    view = false,
  ) {
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
        if (!win) toast.warning('Pop-up bloqueado — use o botão de download.');
      } else {
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `cte-${cte.access_key || cte.invoice_number || cte.id}.${kind}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      toast.success(`${label} ${view ? 'aberto' : 'baixado'}`, { id: toastId });
    } catch (error: unknown) {
      toast.error(`Falha ao obter ${label}`, {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>;
  }
  if (ctes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Nenhum CT-e transmitido ao Hub Fiscal ainda.
      </p>
    );
  }

  return (
    <>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Data</TableHead>
          <TableHead>Nº / Chave</TableHead>
          <TableHead>Remetente</TableHead>
          <TableHead>Destinatário</TableHead>
          <TableHead className="text-right">NFs</TableHead>
          <TableHead className="text-right">Frete</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ctes.map(c => {
          const open = !!expanded[c.id];
          return (
            <Fragment key={c.id}>
              <TableRow
                className="cursor-pointer"
                onClick={() => setExpanded(p => ({ ...p, [c.id]: !open }))}
              >
                <TableCell>
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </TableCell>
                <TableCell className="text-sm">{format(new Date(c.created_at), 'dd/MM/yyyy HH:mm')}</TableCell>
                <TableCell className="text-xs font-mono">{c.access_key || c.invoice_number || '—'}</TableCell>
                <TableCell className="text-sm">{c.remitter || '—'}</TableCell>
                <TableCell className="text-sm">
                  {c.recipient || '—'}
                  {c.recipient_city ? <span className="text-muted-foreground text-xs"> • {c.recipient_city}/{c.recipient_state}</span> : null}
                </TableCell>
                <TableCell className="text-right font-medium">{c.notes.length}</TableCell>
                <TableCell className="text-right">
                  R$ {c.freight_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={
                    c.sefaz_status === 'cancel_rejected' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                    c.status === 'authorized' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                    c.status === 'rejected' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                    c.status === 'cancelled' ? 'bg-muted text-muted-foreground' :
                    'bg-amber-500/10 text-amber-600 border-amber-500/20'
                  } title={c.sefaz_message || undefined}>
                    {c.sefaz_status === 'cancel_rejected' ? 'Cancelamento rejeitado'
                      : c.status === 'authorized' ? 'Autorizado'
                      : c.status === 'rejected' ? 'Rejeitado'
                      : c.status === 'cancelled' ? 'Cancelado'
                      : 'Transmitindo'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Visualizar DACTE (PDF) — busca sob demanda no Hub Fiscal"
                      onClick={() => fetchDocument(c, 'pdf', true)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Baixar PDF (DACTE)"
                      onClick={() => fetchDocument(c, 'pdf')}
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Baixar XML"
                      onClick={() => fetchDocument(c, 'xml')}
                    >
                      <FileDown className="h-4 w-4" />
                    </Button>
                    {c.status !== 'cancelled' && c.sefaz_status !== 'cancel_rejected' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={!c.hub_document_id}
                        title={c.hub_document_id ? 'Cancelar CT-e na SEFAZ' : 'CT-e ainda não transmitido ao Hub Fiscal'}
                        onClick={() =>
                          setCancelTarget({
                            id: c.id,
                            label: c.invoice_number ? `nº ${c.invoice_number}` : c.id.slice(0, 8),
                            accessKey: c.access_key,
                            notesCount: c.notes.length,
                          })
                        }
                      >
                        <XCircle className="h-4 w-4 mr-1" /> Cancelar
                      </Button>
                    )}
                    {(c.status !== 'authorized' || c.sefaz_status === 'cancel_rejected' || c.sefaz_status === 'cancelled') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        title="Excluir registro local do CT-e e liberar as NFs vinculadas"
                        onClick={() =>
                          setDeleteTarget({
                            id: c.id,
                            label: c.invoice_number ? `nº ${c.invoice_number}` : c.id.slice(0, 8),
                            notesCount: c.notes.length,
                            authorized: c.sefaz_status === 'cancel_rejected',
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4 mr-1" /> Excluir
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
              {open && (
                <TableRow>
                  <TableCell colSpan={9} className="bg-muted/30">
                    {c.notes.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">
                        Nenhuma NF vinculada a este CT-e.
                      </p>
                    ) : (
                      <div className="py-1">
                        <p className="text-xs text-muted-foreground mb-1">NFs agrupadas neste CT-e</p>
                        <div className="flex flex-wrap gap-1">
                          {c.notes.map(n => (
                            <Badge key={n.id} variant="secondary" className="font-mono text-xs">
                              NF {n.invoice_number || n.id.slice(0, 8)} • R$ {n.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
    <CancelCteDialog target={cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)} />
    <AlertDialog
      open={!!deleteTarget}
      onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteConfirm(''); } }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir CT-e {deleteTarget?.label}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                O registro local será removido e {deleteTarget?.notesCount ?? 0} NF(s) vinculada(s) voltarão
                a ficar disponíveis para novo faturamento.
              </p>
              {deleteTarget?.authorized && (
                <p className="text-destructive font-medium">
                  Atenção: este CT-e teve o cancelamento rejeitado pela SEFAZ, portanto continua válido
                  fiscalmente. Excluir aqui remove apenas o controle interno — o documento permanece na
                  SEFAZ e deve ser tratado com CT-e de anulação/substituição.
                </p>
              )}
              <p>Digite <span className="font-mono font-semibold">EXCLUIR</span> para confirmar.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value.toUpperCase())}
          placeholder="EXCLUIR"
          className="font-mono"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleteConfirm !== 'EXCLUIR' || deleteCte.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (!deleteTarget) return;
              deleteCte.mutate(deleteTarget.id, {
                onSuccess: () => {
                  toast.success('CT-e excluído — NFs liberadas para novo faturamento');
                  setDeleteTarget(null);
                  setDeleteConfirm('');
                },
                onError: (error: unknown) => toast.error(
                  error instanceof Error ? error.message : 'Falha ao excluir CT-e',
                ),
              });
            }}
          >
            {deleteCte.isPending ? 'Excluindo...' : 'Excluir CT-e'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
